import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { GstTaxTreatment } from "@prisma/client";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, forbidden } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { quickCreateProduct, searchPurchaseItems } from "@/server/purchasing/purchaseItems";

export const runtime = "nodejs";

/** Products for a purchase line, by name / SKU / barcode, with sizes, stock and last cost. */
export async function GET(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    const c = resolved.context;
    if (!canManageInventory(c)) return forbidden(correlationId, "Your role can't record purchases.");
    const results = await searchPurchaseItems({ tenantId: c.tenantId, storeId: c.storeId, q: req.nextUrl.searchParams.get("q") ?? "" });
    return NextResponse.json({ status: "ok", results, correlationId });
  } catch (err) {
    logError("purchase-items: search failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Search didn't work. Try again.", correlationId });
  }
}

const customVariantPriceSchema = z.object({
  size: z.string().nullable().optional(),
  colour: z.string().nullable().optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
  costPriceMinor: z.number().int().nonnegative().nullable().optional(),
  priceMinor: z.number().int().positive(),
  mrpMinor: z.number().int().positive().nullable().optional(),
  quantity: z.number().int().nonnegative().optional(),
});

const createBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    brand: z.string().trim().max(100).nullable().optional(),
    category: z.string().trim().max(100).nullable().optional(),
    imageUrl: z.string().trim().max(1000).nullable().optional(),
    sizes: z.array(z.string().max(30)).max(30).default([]),
    colours: z.array(z.string().max(30)).max(30).default([]),
    costPriceMinor: z.number().int().nonnegative().nullable().optional(),
    priceMinor: z.number().int().positive(),
    mrpMinor: z.number().int().positive().nullable().optional(),
    barcode: z.string().trim().max(100).nullable().optional(),
    customSizePrices: z.array(customVariantPriceSchema).optional(),
    uomCode: z.string().trim().max(20).nullable().optional(),
    gst: z.object({
      treatment: z.nativeEnum(GstTaxTreatment),
      rateMode: z.enum(["FIXED", "APPAREL_SLAB"]),
      rateBp: z.number().int().min(0).max(10_000),
      exemptionRef: z.string().trim().max(200).nullable().optional(),
    }),
  })
  .strict();

/** Create a new product with all its sizes and colours from the purchase screen (owner). */
export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    const parsed = createBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError({ code: "validation_error", status: 400, message: "Check the name, sizes, price and GST.", correlationId });
    const c = resolved.context;
    const res = await quickCreateProduct({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole, membershipRole: c.membershipRole },
      storeId: c.storeId,
      ...parsed.data,
    });
    if (res.status === "forbidden") return forbidden(correlationId, "Only the owner can add new products.");
    if (res.status === "invalid") return apiError({ code: "validation_error", status: 400, message: res.reason, correlationId });
    return NextResponse.json({ status: "ok", product: res.product, correlationId }, { status: 201 });
  } catch (err) {
    logError("purchase-items: create failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Couldn't add the product. Try again.", correlationId });
  }
}
