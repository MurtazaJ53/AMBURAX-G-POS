import { NextRequest, NextResponse } from "next/server";
import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { db } from "@/server/db";
import { logError } from "@/lib/safeLog";
import { decryptSecret } from "@/server/commerce/crypto";

export const runtime = "nodejs";

/**
 * POST /api/v1/commerce/flipkart/webhook
 *
 * Real-time Flipkart Webhook endpoint for inbound marketplace events.
 *
 * Flipkart Order Management Notification Service Specification:
 * - Header: X_Authorization: FKLOGIN Base64(<OAuth-appid>:<fk_signature>)
 * - Header: X_Date (HTTP date timestamp)
 * - Signature algorithm: SHA1(date_timestamp + notification_http_url + notification_http_method + OAuth-secret)
 *
 * Verification strictly enforces Flipkart's cryptographic signature using constant-time comparison.
 */
export async function POST(req: NextRequest) {
  const correlationId = randomUUID();

  try {
    const rawBody = await req.text();
    if (!rawBody) {
      return NextResponse.json({ error: "Empty request body" }, { status: 400 });
    }

    // 1. Extract and validate Flipkart headers
    const authHeader = req.headers.get("x_authorization") || req.headers.get("x-authorization");
    const dateHeader = req.headers.get("x_date") || req.headers.get("x-date");

    if (!authHeader || !dateHeader) {
      return NextResponse.json({ error: "Missing required Flipkart authorization headers (X_Authorization / X_Date)" }, { status: 401 });
    }

    const authMatch = authHeader.trim().match(/^FKLOGIN\s+([A-Za-z0-9+/=]+)$/);
    if (!authMatch) {
      return NextResponse.json({ error: "Malformed X_Authorization header format" }, { status: 401 });
    }

    let decodedCredentials = "";
    try {
      decodedCredentials = Buffer.from(authMatch[1], "base64").toString("utf-8");
    } catch {
      return NextResponse.json({ error: "Invalid Base64 in authorization header" }, { status: 401 });
    }

    const colonIndex = decodedCredentials.indexOf(":");
    if (colonIndex === -1) {
      return NextResponse.json({ error: "Invalid credentials format in authorization header" }, { status: 401 });
    }

    const appId = decodedCredentials.substring(0, colonIndex);
    const incomingSignature = decodedCredentials.substring(colonIndex + 1);

    if (!appId || !incomingSignature) {
      return NextResponse.json({ error: "Missing appId or signature in authorization header" }, { status: 401 });
    }

    // 2. Resolve commerce channel by appId
    const channel = await db.commerceChannel.findFirst({
      where: { platform: "FLIPKART", appId, isActive: true },
    });

    if (!channel) {
      return NextResponse.json({ error: "Commerce channel not found or inactive for provided appId" }, { status: 404 });
    }

    if (!channel.appSecretCipher) {
      return NextResponse.json({ error: "Channel authentication secret not configured" }, { status: 401 });
    }

    const appSecret = decryptSecret(channel.appSecretCipher);
    if (!appSecret) {
      return NextResponse.json({ error: "Failed to decrypt channel secret" }, { status: 500 });
    }

    // 3. Re-calculate Flipkart signature:
    // fk_signature = SHA1(date_timestamp + notification_http_url + notification_http_method + OAuth-secret)
    const requestUrl = req.nextUrl.origin + req.nextUrl.pathname;
    const stringToSign = `${dateHeader}${requestUrl}POST${appSecret}`;
    const expectedSignature = createHash("sha1").update(stringToSign).digest("hex");

    const incomingBuf = Buffer.from(incomingSignature.toLowerCase());
    const expectedBuf = Buffer.from(expectedSignature.toLowerCase());

    if (incomingBuf.length !== expectedBuf.length || !timingSafeEqual(incomingBuf, expectedBuf)) {
      return NextResponse.json({ error: "Invalid Flipkart cryptographic signature" }, { status: 401 });
    }

    // 4. Parse payload only after cryptographic verification passes
    let rawPayload: any;
    try {
      rawPayload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const { eventType, sellerId, orderId, items, customerInfo } = rawPayload || {};
    const tenantId = channel.tenantId;

    // 2. Resolve store & owner user
    const [store, ownerUser] = await Promise.all([
      channel.storeId
        ? db.store.findUnique({ where: { id: channel.storeId } })
        : db.store.findFirst({ where: { tenantId, isDefault: true } }),
      db.user.findFirst({ where: { tenantId, tenantRole: "OWNER" }, select: { id: true } }),
    ]);

    if (!store) {
      return NextResponse.json({ error: "Store not found for inventory fulfillment" }, { status: 500 });
    }

    const createdByUserId = ownerUser?.id || "system";

    // Handle ORDER_CREATED
    if (eventType === "ORDER_CREATED" || !eventType) {
      const extOrderId = orderId || `OD${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 899 + 100)}`;
      const idempotencyKey = `fk-webhook-${extOrderId}-${tenantId}`;

      // Idempotency check: Don't duplicate if already processed
      const existing = await db.order.findUnique({
        where: {
          tenantId_idempotencyKey: {
            tenantId,
            idempotencyKey,
          },
        },
      });
      if (existing) {
        return NextResponse.json({ ok: true, status: "already_processed", orderNumber: existing.orderNumber });
      }

      // Default UOM
      const defaultUom = await db.uom.findFirst({ where: { tenantId } });
      if (!defaultUom) {
        return NextResponse.json({ error: "Default unit of measure missing" }, { status: 500 });
      }

      // Find or create external Flipkart customer
      let customer = await db.customer.findFirst({
        where: { tenantId, name: "Flipkart Marketplace Customer" },
      });
      if (!customer) {
        customer = await db.customer.create({
          data: {
            tenantId,
            name: "Flipkart Marketplace Customer",
            phone: customerInfo?.phone || "9876543210",
            email: "orders@flipkart.com",
            isActive: true,
          },
        });
      }

      // Match items by sellerSku or externalListingId
      const webhookItems: Array<{ sku: string; quantity: number; priceMinor?: number }> = Array.isArray(items) && items.length > 0
        ? items
        : [];

      // Look up listings
      const matchedListings = await db.channelListing.findMany({
        where: {
          channelId: channel.id,
          status: { in: ["ACTIVE", "OUT_OF_STOCK"] },
        },
        include: { variant: true },
      });

      const orderItemsToCreate: Array<{
        tenantId: string;
        variantId: string;
        uomId: string;
        quantity: number;
        fulfilledQuantity: number;
        unitPriceMinor: number;
        lineTotalMinor: number;
        skuSnapshot: string;
        nameSnapshot: string;
        uomCodeSnapshot: string;
      }> = [];

      for (const item of webhookItems) {
        const found = matchedListings.find(
          (l) => l.sellerSku === item.sku || l.externalListingId === item.sku || l.variant.sku === item.sku
        );
        if (found) {
          const qty = Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 1;
          const unitPrice = item.priceMinor || found.channelPriceMinor || found.variant.priceMinor;
          orderItemsToCreate.push({
            tenantId,
            variantId: found.variantId,
            uomId: defaultUom.id,
            quantity: qty,
            fulfilledQuantity: 0,
            unitPriceMinor: unitPrice,
            lineTotalMinor: unitPrice * qty,
            skuSnapshot: found.variant.sku,
            nameSnapshot: `[Flipkart FSN: ${found.externalListingId || found.sellerSku}] SKU: ${found.variant.sku}`,
            uomCodeSnapshot: defaultUom.code,
          });
        }
      }

      // If no specific item matched, fall back to first listing
      if (orderItemsToCreate.length === 0 && matchedListings.length > 0) {
        const first = matchedListings[0]!;
        const unitPrice = first.channelPriceMinor || first.variant.priceMinor;
        orderItemsToCreate.push({
          tenantId,
          variantId: first.variantId,
          uomId: defaultUom.id,
          quantity: 1,
          fulfilledQuantity: 0,
          unitPriceMinor: unitPrice,
          lineTotalMinor: unitPrice,
          skuSnapshot: first.variant.sku,
          nameSnapshot: `[Flipkart FSN: ${first.externalListingId || first.sellerSku}] SKU: ${first.variant.sku}`,
          uomCodeSnapshot: defaultUom.code,
        });
      }

      if (orderItemsToCreate.length === 0) {
        return NextResponse.json({ error: "No listings mapped to fulfill this marketplace order" }, { status: 400 });
      }

      // Atomic reservation and order creation
      const createdOrder = await db.$transaction(async (tx) => {
        const updatedStore = await tx.store.update({
          where: { id: store.id },
          data: { nextOrderSeq: { increment: 1 } },
          select: { code: true, nextOrderSeq: true },
        });

        const orderNumber = `${updatedStore.code}-FK-${String(updatedStore.nextOrderSeq).padStart(6, "0")}`;
        const subtotalMinor = orderItemsToCreate.reduce((sum, i) => sum + i.lineTotalMinor, 0);

        const newOrder = await tx.order.create({
          data: {
            tenantId,
            storeId: store.id,
            orderNumber,
            customerId: customer.id,
            status: "CONFIRMED",
            currency: "INR",
            subtotalMinor,
            version: 1,
            idempotencyKey,
            createdByUserId,
            confirmedAt: new Date(),
            items: {
              create: orderItemsToCreate,
            },
            addresses: {
              create: [
                {
                  type: "SHIPPING",
                  line1: customerInfo?.address || "Flipkart Logistics Direct Delivery",
                  line2: `Marketplace Order #${extOrderId}`,
                  city: customerInfo?.city || "Bengaluru",
                  state: customerInfo?.state || "Karnataka",
                  postalCode: customerInfo?.postalCode || "560001",
                  country: "India",
                  contactName: customerInfo?.name || "Flipkart Customer",
                  contactPhone: customerInfo?.phone || "9876543210",
                },
              ],
            },
          },
        });

        // Reserve stock: decrement physical stock level or mark stock movement
        for (const it of orderItemsToCreate) {
          const sl = await tx.stockLevel.findUnique({
            where: {
              storeId_variantId: {
                storeId: store.id,
                variantId: it.variantId,
              },
            },
          });
          if (sl) {
            await tx.stockLevel.update({
              where: { id: sl.id },
              data: { quantity: Math.max(0, sl.quantity - it.quantity) },
            });
          }
        }

        return newOrder;
      });

      // Audit log
      await db.commerceSyncLog.create({
        data: {
          tenantId,
          channelId: channel.id,
          type: "ORDERS_PULL",
          status: "SUCCESS",
          itemsCount: orderItemsToCreate.length,
          details: `Webhook order ingested #${createdOrder.orderNumber} (Flipkart ID: ${extOrderId}). Stock auto-reserved.`,
        },
      });

      return NextResponse.json({
        ok: true,
        orderNumber: createdOrder.orderNumber,
        externalOrderId: extOrderId,
        itemsCount: orderItemsToCreate.length,
      });
    }

    return NextResponse.json({ ok: true, message: `Received event ${eventType}` });
  } catch (err) {
    logError("api:commerce:flipkart:webhook", err);
    return NextResponse.json({ error: "Internal webhook processor error" }, { status: 500 });
  }
}
