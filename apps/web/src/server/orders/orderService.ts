import { OrderAddressType, OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { consumeForOrder, releaseSource, reserveLines, ReservationShortError } from "@/server/inventory/reservations";
import { writeAuditLog } from "@/server/identity/audit";
import { canSell } from "@/server/sales/saleService";
import { resolvePrice } from "@/server/pricing/pricingService";
import {
  canCancel,
  canTransition,
  deriveFulfilmentStatus,
  isEditable,
  isTerminal,
} from "@/server/orders/orderStatus";
import {
  computeLineTotalMinor,
  computeSubtotalMinor,
  validateFulfilQuantity,
  validateOrderQuantity,
  validateOrderUnitPrice,
} from "@/server/orders/orderTotals";

/**
 * Orders: demand, recorded before anything has been fulfilled.
 *
 * ## This does not replace `saleService`
 *
 * A Sale is still the completed retail transaction — stock moved, money taken, bill printed, all
 * at once. Nothing here touches it, and creating an order does not create a sale. The two
 * documents answer different questions and both remain.
 *
 * ## Nothing commercial comes from the caller
 *
 * The request carries variant ids, units and quantities. Every price is resolved by the P1-8E
 * pricing service against the store, the customer and the quantity; a `unitPriceMinor` in the
 * request body is never read, because there is no field to put it in. Same discipline as
 * `createSale`, and the reason a client sending `unitPriceMinor: 1` cannot buy anything for a
 * paisa.
 *
 * ## Pricing is provisional in DRAFT and locked at confirmation
 *
 * A draft is a working document: its prices are whatever the pricing service said when a line was
 * added. Confirmation is the commitment, so confirmation re-resolves every line and writes the
 * result down. After that the stored price is the agreement, and later edits to any price list
 * cannot reach it.
 *
 * ## No stock is touched. None.
 *
 * Creating, confirming, fulfilling or cancelling an order writes no `StockMovement` and changes
 * no `StockLevel`. The ledger remains the only authority on stock and the projection remains its
 * running sum. `OrderStatus.RESERVED` is unreachable for exactly this reason — see
 * `orderStatus.ts`.
 *
 * ## Capability
 *
 * Not gated. An order is a shared foundation that wholesale, commerce and retail workflows will
 * all sit on; gating it behind RETAIL would make it unavailable to the capabilities it exists to
 * serve. Capability gating belongs on the capability-specific workflows built later.
 *
 * ## Authorization
 *
 * Reuses `canSell` — OWNER, STORE_MANAGER, SALES_ASSOCIATE, CASHIER. Committing the business to
 * supplying goods is a selling act, and the people who may ring up a sale are the people who may
 * take an order. No new role and no RBAC layer.
 */

export interface OrderActor {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
  membershipRole: string | null;
}

export type OrderFailure =
  | { status: "forbidden" }
  | { status: "not_found"; what: "order" | "store" | "customer" | "variant" | "uom" }
  | { status: "validation_error"; field: string; reason: string }
  | { status: "conflict"; reason: string }
  | { status: "no_price"; variantId: string }
  | { status: "currency_mismatch"; reason: string }
  /** The requested status exists, but nothing may reach it from here. */
  | { status: "invalid_transition"; from: OrderStatus; to: OrderStatus }
  /** RESERVED specifically: refused because no reservation accounting exists. */
  | { status: "reservation_unavailable"; variantId?: string; available?: number };

function authorised(actor: OrderActor): boolean {
  return canSell({ tenantRole: actor.tenantRole, membershipRole: actor.membershipRole });
}

export interface OrderLineInput {
  variantId: string;
  uomId: string;
  quantity: number;
}

export interface OrderLineView {
  id: string;
  variantId: string;
  uomId: string;
  quantity: number;
  fulfilledQuantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  skuSnapshot: string;
  nameSnapshot: string;
  uomCodeSnapshot: string;
  priceSourceSnapshot: string | null;
  priceListIdSnapshot: string | null;
}

export interface OrderAddressView {
  type: OrderAddressType;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  contactName: string | null;
  contactPhone: string | null;
}

export interface OrderView {
  id: string;
  orderNumber: string;
  storeId: string;
  customerId: string | null;
  status: OrderStatus;
  currency: string;
  subtotalMinor: number;
  version: number;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  closedAt: Date | null;
  createdAt: Date;
  items: OrderLineView[];
  addresses: OrderAddressView[];
}

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  storeId: true,
  customerId: true,
  status: true,
  currency: true,
  subtotalMinor: true,
  version: true,
  confirmedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  closedAt: true,
  createdAt: true,
  items: {
    select: {
      id: true,
      variantId: true,
      uomId: true,
      quantity: true,
      fulfilledQuantity: true,
      unitPriceMinor: true,
      lineTotalMinor: true,
      skuSnapshot: true,
      nameSnapshot: true,
      uomCodeSnapshot: true,
      priceSourceSnapshot: true,
      priceListIdSnapshot: true,
    },
    orderBy: { createdAt: "asc" },
  },
  addresses: {
    select: {
      type: true,
      line1: true,
      line2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      contactName: true,
      contactPhone: true,
    },
  },
} satisfies Prisma.OrderSelect;

const MAX_LINES_PER_ORDER = 200;

type ResolvedLine = {
  variantId: string;
  uomId: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  skuSnapshot: string;
  nameSnapshot: string;
  uomCodeSnapshot: string;
  priceSourceSnapshot: string;
  priceListIdSnapshot: string | null;
};

/**
 * Turn requested lines into priced lines, or fail.
 *
 * Every lookup is tenant-scoped, so another tenant's variant or unit is indistinguishable from
 * one that does not exist — no cross-tenant existence oracle. The price comes from `resolvePrice`
 * and nowhere else, which is also what validates the unit against the variant: the pricing
 * service already knows the base-unit rule and refuses a unit it cannot price.
 */
async function resolveLines(params: {
  tenantId: string;
  storeId: string;
  customerId: string | null;
  lines: OrderLineInput[];
}): Promise<{ status: "ok"; lines: ResolvedLine[] } | OrderFailure> {
  if (params.lines.length === 0) {
    return { status: "validation_error", field: "lines", reason: "Add at least one item." };
  }
  if (params.lines.length > MAX_LINES_PER_ORDER) {
    return {
      status: "validation_error",
      field: "lines",
      reason: `An order cannot have more than ${MAX_LINES_PER_ORDER} lines.`,
    };
  }

  // Two lines for the same variant and unit are a retry artefact, not a business fact. The
  // database refuses them too; catching it here gives the caller a sentence instead of a P2002.
  const seen = new Set<string>();
  for (const line of params.lines) {
    const key = `${line.variantId}::${line.uomId}`;
    if (seen.has(key)) {
      return {
        status: "validation_error",
        field: "lines",
        reason: "The same item appears twice in the same unit. Combine the quantities.",
      };
    }
    seen.add(key);
  }

  const resolved: ResolvedLine[] = [];

  for (const line of params.lines) {
    const quantityError = validateOrderQuantity(line.quantity);
    if (quantityError) {
      return {
        status: "validation_error",
        field: "quantity",
        reason:
          quantityError === "too_large"
            ? "That quantity is too large."
            : "Enter a whole quantity of at least 1.",
      };
    }

    const variant = await db.productVariant.findFirst({
      where: { id: line.variantId, tenantId: params.tenantId },
      select: { id: true, sku: true, isActive: true, product: { select: { name: true } } },
    });
    if (!variant) return { status: "not_found", what: "variant" };
    if (!variant.isActive) {
      return {
        status: "validation_error",
        field: "variantId",
        reason: "That item is no longer for sale.",
      };
    }

    const uom = await db.uom.findFirst({
      where: { id: line.uomId, tenantId: params.tenantId },
      select: { id: true, code: true, isActive: true },
    });
    if (!uom) return { status: "not_found", what: "uom" };
    if (!uom.isActive) {
      return { status: "validation_error", field: "uomId", reason: "That unit is retired." };
    }

    const priced = await resolvePrice({
      tenantId: params.tenantId,
      storeId: params.storeId,
      variantId: line.variantId,
      uomId: line.uomId,
      quantity: line.quantity,
      customerId: params.customerId,
    });

    if (priced.status === "no_price") return { status: "no_price", variantId: line.variantId };
    if (priced.status === "currency_mismatch") {
      return {
        status: "currency_mismatch",
        reason: `A price list in ${priced.listCurrency} cannot be used by a store selling in ${priced.storeCurrency}.`,
      };
    }
    if (priced.status === "not_found") {
      return { status: "not_found", what: priced.what === "price_list" ? "order" : priced.what };
    }
    if (priced.status !== "ok") {
      return {
        status: "validation_error",
        field: "lines",
        reason: "That item could not be priced.",
      };
    }

    // Belt and braces. The pricing service already enforces this; an order line carrying a
    // negative or fractional price would be a silent corruption rather than a visible failure.
    if (validateOrderUnitPrice(priced.unitPriceMinor)) {
      return {
        status: "validation_error",
        field: "unitPriceMinor",
        reason: "The resolved price is not a valid amount.",
      };
    }

    resolved.push({
      variantId: line.variantId,
      uomId: line.uomId,
      quantity: line.quantity,
      unitPriceMinor: priced.unitPriceMinor,
      lineTotalMinor: computeLineTotalMinor(line.quantity, priced.unitPriceMinor),
      skuSnapshot: variant.sku,
      nameSnapshot: variant.product.name,
      uomCodeSnapshot: uom.code,
      priceSourceSnapshot: priced.source,
      priceListIdSnapshot: priced.priceListId,
    });
  }

  return { status: "ok", lines: resolved };
}

export type CreateOrderResult =
  | { status: "ok"; order: OrderView; duplicate: boolean }
  | OrderFailure;

/**
 * Create a DRAFT order.
 *
 * Idempotent on `(tenantId, idempotencyKey)`, exactly as `createSale` is. The fast-path read
 * makes a retry cheap; the unique index is the actual guarantee, and the catch at the end
 * resolves a lost race by returning the winner's order rather than failing the retry.
 */
export async function createOrder(params: {
  actor: OrderActor;
  storeId: string;
  customerId?: string | null;
  lines: OrderLineInput[];
  idempotencyKey: string;
  correlationId: string;
}): Promise<CreateOrderResult> {
  const { tenantId } = params.actor;

  const existing = await db.order.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: params.idempotencyKey } },
    select: ORDER_SELECT,
  });
  if (existing) return { status: "ok", order: existing, duplicate: true };

  if (!authorised(params.actor)) return { status: "forbidden" };

  const store = await db.store.findFirst({
    where: { id: params.storeId, tenantId },
    select: { id: true, code: true, currency: true },
  });
  if (!store) return { status: "not_found", what: "store" };

  const customerId = params.customerId ?? null;
  if (customerId) {
    const customer = await db.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!customer) return { status: "not_found", what: "customer" };
  }

  const resolved = await resolveLines({
    tenantId,
    storeId: store.id,
    customerId,
    lines: params.lines,
  });
  if (resolved.status !== "ok") return resolved;

  try {
    const order = await db.$transaction(async (tx) => {
      // Allocating the order number first takes the Store row lock for the transaction's life,
      // so two concurrent callers cannot be issued the same number. Identical discipline to
      // `billNumber`, on a separate counter.
      const counter = await tx.store.update({
        where: { id: store.id },
        data: { nextOrderSeq: { increment: 1 } },
        select: { nextOrderSeq: true, code: true },
      });
      const orderNumber = `${counter.code}-SO-${String(counter.nextOrderSeq - 1).padStart(6, "0")}`;

      const created = await tx.order.create({
        data: {
          tenantId,
          storeId: store.id,
          orderNumber,
          customerId,
          currency: store.currency.trim().toUpperCase(),
          subtotalMinor: computeSubtotalMinor(resolved.lines),
          idempotencyKey: params.idempotencyKey,
          createdByUserId: params.actor.userId,
        },
        select: { id: true },
      });

      // Lines are written as their own statement rather than as a nested create. The composite
      // relation `(orderId, tenantId)` means Prisma treats `tenantId` as owned by the relation
      // and refuses it as a field in a nested create — the price of proving tenant ownership in
      // the database rather than trusting the code that writes it.
      await tx.orderItem.createMany({
        data: resolved.lines.map((line) => ({
          tenantId,
          orderId: created.id,
          variantId: line.variantId,
          uomId: line.uomId,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          lineTotalMinor: line.lineTotalMinor,
          skuSnapshot: line.skuSnapshot,
          nameSnapshot: line.nameSnapshot,
          uomCodeSnapshot: line.uomCodeSnapshot,
          priceSourceSnapshot: line.priceSourceSnapshot,
          priceListIdSnapshot: line.priceListIdSnapshot,
        })),
      });

      return tx.order.findUniqueOrThrow({ where: { id: created.id }, select: ORDER_SELECT });
    });

    await writeAuditLog({
      tenantId,
      userId: params.actor.userId,
      action: "OrderCreated",
      correlationId: params.correlationId,
      metadata: { orderId: order.id, orderNumber: order.orderNumber, lines: order.items.length },
    });

    return { status: "ok", order, duplicate: false };
  } catch (err) {
    // Lost the idempotency race: another request with the same key committed first. Its order is
    // the correct answer, not an error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await db.order.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: params.idempotencyKey } },
        select: ORDER_SELECT,
      });
      if (winner) return { status: "ok", order: winner, duplicate: true };
    }
    throw err;
  }
}

export type GetOrderResult = { status: "ok"; order: OrderView } | OrderFailure;

/** One order, scoped to the caller's tenant. Another tenant's order reads as not found. */
export async function getOrder(params: {
  actor: OrderActor;
  orderId: string;
}): Promise<GetOrderResult> {
  const order = await db.order.findFirst({
    where: { id: params.orderId, tenantId: params.actor.tenantId },
    select: ORDER_SELECT,
  });
  if (!order) return { status: "not_found", what: "order" };
  return { status: "ok", order };
}

/** The tenant's orders, newest first. Never another tenant's — the filter is not optional. */
export async function listOrders(params: {
  tenantId: string;
  status?: OrderStatus;
  limit?: number;
}): Promise<OrderView[]> {
  return db.order.findMany({
    where: { tenantId: params.tenantId, ...(params.status ? { status: params.status } : {}) },
    select: ORDER_SELECT,
    orderBy: { createdAt: "desc" },
    take: Math.min(params.limit ?? 50, 200),
  });
}

/**
 * The customer's default billing and shipping addresses, as flat snapshot rows.
 *
 * A full copy, never a reference: the snapshot has to survive the customer editing or retiring
 * the address afterwards. `sourceAddressId` records which address was copied, for provenance
 * only — nothing reads through it to render the order.
 */
interface AddressSnapshotRow {
  type: OrderAddressType;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  contactName: string | null;
  contactPhone: string | null;
  sourceAddressId: string;
}

async function readCustomerAddresses(
  tenantId: string,
  customerId: string,
): Promise<AddressSnapshotRow[]> {
  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { defaultBilling: true, defaultShipping: true },
  });
  if (!customer) return [];

  const rows: AddressSnapshotRow[] = [];
  const pairs: [OrderAddressType, typeof customer.defaultBilling][] = [
    [OrderAddressType.BILLING, customer.defaultBilling],
    [OrderAddressType.SHIPPING, customer.defaultShipping],
  ];

  for (const [type, address] of pairs) {
    if (!address) continue;
    rows.push({
      type,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
      contactName: address.contactName,
      contactPhone: address.contactPhone,
      sourceAddressId: address.id,
    });
  }

  return rows;
}

export type ConfirmOrderResult = { status: "ok"; order: OrderView } | OrderFailure;

/**
 * DRAFT -> CONFIRMED. The moment the order stops being a working document.
 *
 * Three things happen here and nowhere else:
 *
 * 1. **Prices are re-resolved and locked.** A draft may have sat for days; what the business
 *    commits to is the price at the moment of commitment, not what was quoted when someone first
 *    added the line.
 * 2. **Addresses are snapshotted.** Copied in full from the customer's defaults, per
 *    docs/architecture/ADDRESS.md: editing a customer's address later must never rewrite where
 *    something was already sent. A walk-in order with no customer simply has no snapshot.
 * 3. **The version is bumped conditionally**, so two simultaneous confirmations cannot both win.
 */
export async function confirmOrder(params: {
  actor: OrderActor;
  orderId: string;
  expectedVersion?: number;
  correlationId: string;
}): Promise<ConfirmOrderResult> {
  if (!authorised(params.actor)) return { status: "forbidden" };
  const { tenantId } = params.actor;

  const order = await db.order.findFirst({
    where: { id: params.orderId, tenantId },
    select: {
      id: true,
      status: true,
      version: true,
      storeId: true,
      customerId: true,
      items: { select: { variantId: true, uomId: true, quantity: true } },
    },
  });
  if (!order) return { status: "not_found", what: "order" };

  if (!canTransition(order.status, OrderStatus.CONFIRMED)) {
    return { status: "invalid_transition", from: order.status, to: OrderStatus.CONFIRMED };
  }
  if (params.expectedVersion !== undefined && params.expectedVersion !== order.version) {
    return { status: "conflict", reason: "This order changed while you were working on it." };
  }
  if (order.items.length === 0) {
    return {
      status: "validation_error",
      field: "lines",
      reason: "An empty order cannot be confirmed.",
    };
  }

  const resolved = await resolveLines({
    tenantId,
    storeId: order.storeId,
    customerId: order.customerId,
    lines: order.items.map((item) => ({
      variantId: item.variantId,
      uomId: item.uomId,
      quantity: item.quantity,
    })),
  });
  if (resolved.status !== "ok") return resolved;

  const addresses = order.customerId ? await readCustomerAddresses(tenantId, order.customerId) : [];

  const updated = await db.$transaction(async (tx) => {
    // Conditional on the version we read. Zero rows means somebody else moved this order first,
    // and this attempt must fail rather than overwrite their transition.
    const claimed = await tx.order.updateMany({
      where: { id: order.id, tenantId, version: order.version, status: OrderStatus.DRAFT },
      data: {
        status: OrderStatus.CONFIRMED,
        confirmedAt: new Date(),
        subtotalMinor: computeSubtotalMinor(resolved.lines),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) return null;

    for (const line of resolved.lines) {
      await tx.orderItem.updateMany({
        where: { orderId: order.id, tenantId, variantId: line.variantId, uomId: line.uomId },
        data: {
          unitPriceMinor: line.unitPriceMinor,
          lineTotalMinor: line.lineTotalMinor,
          priceSourceSnapshot: line.priceSourceSnapshot,
          priceListIdSnapshot: line.priceListIdSnapshot,
          skuSnapshot: line.skuSnapshot,
          nameSnapshot: line.nameSnapshot,
          uomCodeSnapshot: line.uomCodeSnapshot,
        },
      });
    }

    if (addresses.length > 0) {
      await tx.orderAddress.createMany({
        data: addresses.map((address) => ({ ...address, tenantId, orderId: order.id })),
        skipDuplicates: true,
      });
    }

    return tx.order.findUniqueOrThrow({ where: { id: order.id }, select: ORDER_SELECT });
  });

  if (!updated) {
    return { status: "conflict", reason: "This order changed while you were working on it." };
  }

  await writeAuditLog({
    tenantId,
    userId: params.actor.userId,
    action: "OrderConfirmed",
    correlationId: params.correlationId,
    metadata: { orderId: order.id, subtotalMinor: updated.subtotalMinor },
  });

  return { status: "ok", order: updated };
}

export type CancelOrderResult = { status: "ok"; order: OrderView } | OrderFailure;

/**
 * Cancel an order, with a reason.
 *
 * The reason is required. An unexplained cancellation is indistinguishable from a mistake — the
 * same reasoning that makes `StockMovement.reason` mandatory for an adjustment.
 *
 * Only DRAFT and CONFIRMED may be cancelled. A partially fulfilled order is refused, because
 * cancelling it would mean cancelling the remainder, which is a different operation on different
 * data. See `orderStatus.ts`.
 */
export async function cancelOrder(params: {
  actor: OrderActor;
  orderId: string;
  reason: string;
  expectedVersion?: number;
  correlationId: string;
}): Promise<CancelOrderResult> {
  if (!authorised(params.actor)) return { status: "forbidden" };
  const { tenantId } = params.actor;

  const reason = params.reason.trim().replace(/\s+/g, " ");
  if (reason.length < 3 || reason.length > 500) {
    return {
      status: "validation_error",
      field: "reason",
      reason: "Say why the order is being cancelled.",
    };
  }

  const order = await db.order.findFirst({
    where: { id: params.orderId, tenantId },
    select: { id: true, status: true, version: true },
  });
  if (!order) return { status: "not_found", what: "order" };

  if (!canCancel(order.status)) {
    return { status: "invalid_transition", from: order.status, to: OrderStatus.CANCELLED };
  }
  if (params.expectedVersion !== undefined && params.expectedVersion !== order.version) {
    return { status: "conflict", reason: "This order changed while you were working on it." };
  }

  // Cancelling releases any stock the order had reserved, in the same transaction.
  const claimed = await db.$transaction(async (tx) => {
    const c = await tx.order.updateMany({
      where: { id: order.id, tenantId, version: order.version, status: order.status },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: reason,
        version: { increment: 1 },
      },
    });
    if (c.count === 1) await releaseSource(tx, { tenantId, source: "ORDER", sourceId: order.id, reason: `Order cancelled: ${reason}` });
    return c;
  });
  if (claimed.count === 0) {
    return { status: "conflict", reason: "This order changed while you were working on it." };
  }

  await writeAuditLog({
    tenantId,
    userId: params.actor.userId,
    action: "OrderCancelled",
    correlationId: params.correlationId,
    metadata: { orderId: order.id, from: order.status, reason },
  });

  const updated = await db.order.findUniqueOrThrow({
    where: { id: order.id },
    select: ORDER_SELECT,
  });
  return { status: "ok", order: updated };
}

export interface FulfilLineInput {
  orderItemId: string;
  quantity: number;
}

export type RecordFulfilmentResult = { status: "ok"; order: OrderView } | OrderFailure;

/**
 * Record that some of the ordered quantity has been met.
 *
 * **This is quantity accounting, not a fulfilment engine.** It writes no stock movement, creates
 * no shipment, and knows nothing about picking, packing, couriers or tracking numbers. It exists
 * because PARTIALLY_FULFILLED and FULFILLED must be derived from recorded fact rather than set by
 * a client sending a status string — the same reason RESERVED is unreachable rather than
 * settable.
 *
 * The resulting status comes from `deriveFulfilmentStatus`, never from the caller.
 */
export async function recordFulfilment(params: {
  actor: OrderActor;
  orderId: string;
  lines: FulfilLineInput[];
  expectedVersion?: number;
  correlationId: string;
}): Promise<RecordFulfilmentResult> {
  if (!authorised(params.actor)) return { status: "forbidden" };
  const { tenantId } = params.actor;

  if (params.lines.length === 0) {
    return { status: "validation_error", field: "lines", reason: "Nothing to record." };
  }

  const order = await db.order.findFirst({
    where: { id: params.orderId, tenantId },
    select: {
      id: true,
      status: true,
      version: true,
      items: { select: { id: true, quantity: true, fulfilledQuantity: true, variantId: true } },
    },
  });
  if (!order) return { status: "not_found", what: "order" };

  if (
    isTerminal(order.status) ||
    (order.status !== OrderStatus.CONFIRMED &&
      order.status !== OrderStatus.RESERVED &&
      order.status !== OrderStatus.PARTIALLY_FULFILLED)
  ) {
    return {
      status: "invalid_transition",
      from: order.status,
      to: OrderStatus.PARTIALLY_FULFILLED,
    };
  }
  if (params.expectedVersion !== undefined && params.expectedVersion !== order.version) {
    return { status: "conflict", reason: "This order changed while you were working on it." };
  }

  const byId = new Map(order.items.map((item) => [item.id, item]));
  const projected = new Map(order.items.map((item) => [item.id, item.fulfilledQuantity]));

  for (const line of params.lines) {
    const item = byId.get(line.orderItemId);
    // A line id from another order — or another tenant's order — reads as not found, the same as
    // one that never existed.
    if (!item) return { status: "not_found", what: "order" };

    const already = projected.get(line.orderItemId) ?? 0;
    const error = validateFulfilQuantity(line.quantity, already, item.quantity);
    if (error) {
      return {
        status: "validation_error",
        field: "quantity",
        reason:
          error === "exceeds_ordered"
            ? "That is more than was ordered on this line."
            : "Enter a whole quantity of at least 1.",
      };
    }
    projected.set(line.orderItemId, already + line.quantity);
  }

  const nextStatus = deriveFulfilmentStatus(
    order.status,
    order.items.map((item) => ({
      quantity: item.quantity,
      fulfilledQuantity: projected.get(item.id) ?? item.fulfilledQuantity,
    })),
  );

  if (nextStatus !== order.status && !canTransition(order.status, nextStatus)) {
    return { status: "invalid_transition", from: order.status, to: nextStatus };
  }

  const updated = await db.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: order.id, tenantId, version: order.version, status: order.status },
      data: { status: nextStatus, version: { increment: 1 } },
    });
    if (claimed.count === 0) return null;

    for (const [itemId, fulfilledQuantity] of projected) {
      await tx.orderItem.updateMany({
        where: { id: itemId, tenantId, orderId: order.id },
        data: { fulfilledQuantity },
      });
      // Delivered units no longer need holding: the order's reservation shrinks by the same amount.
      const item = byId.get(itemId)!;
      const delivered = fulfilledQuantity - item.fulfilledQuantity;
      if (delivered > 0) {
        await consumeForOrder(tx, { tenantId, orderId: order.id, variantId: item.variantId, quantity: delivered });
      }
    }

    return tx.order.findUniqueOrThrow({ where: { id: order.id }, select: ORDER_SELECT });
  });

  if (!updated) {
    return { status: "conflict", reason: "This order changed while you were working on it." };
  }

  await writeAuditLog({
    tenantId,
    userId: params.actor.userId,
    action: "OrderFulfilmentRecorded",
    correlationId: params.correlationId,
    metadata: { orderId: order.id, status: nextStatus },
  });

  return { status: "ok", order: updated };
}

export type CloseOrderResult = { status: "ok"; order: OrderView } | OrderFailure;

/** FULFILLED -> CLOSED. The last transition; nothing about a closed order changes again. */
export async function closeOrder(params: {
  actor: OrderActor;
  orderId: string;
  expectedVersion?: number;
  correlationId: string;
}): Promise<CloseOrderResult> {
  if (!authorised(params.actor)) return { status: "forbidden" };
  const { tenantId } = params.actor;

  const order = await db.order.findFirst({
    where: { id: params.orderId, tenantId },
    select: { id: true, status: true, version: true },
  });
  if (!order) return { status: "not_found", what: "order" };

  if (!canTransition(order.status, OrderStatus.CLOSED)) {
    return { status: "invalid_transition", from: order.status, to: OrderStatus.CLOSED };
  }
  if (params.expectedVersion !== undefined && params.expectedVersion !== order.version) {
    return { status: "conflict", reason: "This order changed while you were working on it." };
  }

  const claimed = await db.order.updateMany({
    where: { id: order.id, tenantId, version: order.version, status: order.status },
    data: { status: OrderStatus.CLOSED, closedAt: new Date(), version: { increment: 1 } },
  });
  if (claimed.count === 0) {
    return { status: "conflict", reason: "This order changed while you were working on it." };
  }

  await writeAuditLog({
    tenantId,
    userId: params.actor.userId,
    action: "OrderClosed",
    correlationId: params.correlationId,
    metadata: { orderId: order.id },
  });

  const updated = await db.order.findUniqueOrThrow({
    where: { id: order.id },
    select: ORDER_SELECT,
  });
  return { status: "ok", order: updated };
}

export type UpdateDraftResult = { status: "ok"; order: OrderView } | OrderFailure;

/**
 * Replace a DRAFT's lines. Only a draft, and only its lines and customer.
 *
 * Everything else — the order number, the store, the currency, the status, the version — is not
 * editable by any caller at any point. `isEditable` is the gate: once an order is confirmed it is
 * a commitment, and a commitment that can be quietly rewritten is not one.
 */
export async function updateDraftOrder(params: {
  actor: OrderActor;
  orderId: string;
  lines: OrderLineInput[];
  customerId?: string | null;
  expectedVersion?: number;
  correlationId: string;
}): Promise<UpdateDraftResult> {
  if (!authorised(params.actor)) return { status: "forbidden" };
  const { tenantId } = params.actor;

  const order = await db.order.findFirst({
    where: { id: params.orderId, tenantId },
    select: { id: true, status: true, version: true, storeId: true, customerId: true },
  });
  if (!order) return { status: "not_found", what: "order" };

  if (!isEditable(order.status)) {
    return { status: "conflict", reason: "Only a draft order can be changed." };
  }
  if (params.expectedVersion !== undefined && params.expectedVersion !== order.version) {
    return { status: "conflict", reason: "This order changed while you were working on it." };
  }

  const customerId = params.customerId === undefined ? order.customerId : params.customerId;
  if (customerId) {
    const customer = await db.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!customer) return { status: "not_found", what: "customer" };
  }

  const resolved = await resolveLines({
    tenantId,
    storeId: order.storeId,
    customerId,
    lines: params.lines,
  });
  if (resolved.status !== "ok") return resolved;

  const updated = await db.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: order.id, tenantId, version: order.version, status: OrderStatus.DRAFT },
      data: {
        customerId,
        subtotalMinor: computeSubtotalMinor(resolved.lines),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) return null;

    await tx.orderItem.deleteMany({ where: { orderId: order.id, tenantId } });
    await tx.orderItem.createMany({
      data: resolved.lines.map((line) => ({
        tenantId,
        orderId: order.id,
        variantId: line.variantId,
        uomId: line.uomId,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineTotalMinor: line.lineTotalMinor,
        skuSnapshot: line.skuSnapshot,
        nameSnapshot: line.nameSnapshot,
        uomCodeSnapshot: line.uomCodeSnapshot,
        priceSourceSnapshot: line.priceSourceSnapshot,
        priceListIdSnapshot: line.priceListIdSnapshot,
      })),
    });

    return tx.order.findUniqueOrThrow({ where: { id: order.id }, select: ORDER_SELECT });
  });

  if (!updated) {
    return { status: "conflict", reason: "This order changed while you were working on it." };
  }

  await writeAuditLog({
    tenantId,
    userId: params.actor.userId,
    action: "OrderDraftUpdated",
    correlationId: params.correlationId,
    metadata: { orderId: order.id, lines: updated.items.length },
  });

  return { status: "ok", order: updated };
}

export type TransitionOrderResult = { status: "ok"; order: OrderView } | OrderFailure;

/**
 * The single entry point a transition endpoint uses, dispatching to the operation that actually
 * knows how to perform each move.
 *
 * There is deliberately no "set the status to whatever you sent" path. Every transition either
 * has real work behind it — re-resolving prices, snapshotting addresses, recording quantities —
 * or is refused. A status column any caller can assign is not a state machine.
 *
 * RESERVED is refused with its own distinct result rather than a generic invalid transition,
 * because the reason matters: it is not that the order is in the wrong state, it is that this
 * system has no reservation accounting and would be lying if it said otherwise.
 */
export async function transitionOrder(params: {
  actor: OrderActor;
  orderId: string;
  to: OrderStatus;
  reason?: string;
  expectedVersion?: number;
  correlationId: string;
}): Promise<TransitionOrderResult> {
  if (params.to === OrderStatus.RESERVED) {
    return reserveOrder({
      actor: params.actor,
      orderId: params.orderId,
      expectedVersion: params.expectedVersion,
      correlationId: params.correlationId,
    });
  }

  switch (params.to) {
    case OrderStatus.CONFIRMED:
      return confirmOrder({
        actor: params.actor,
        orderId: params.orderId,
        expectedVersion: params.expectedVersion,
        correlationId: params.correlationId,
      });

    case OrderStatus.CANCELLED:
      return cancelOrder({
        actor: params.actor,
        orderId: params.orderId,
        reason: params.reason ?? "",
        expectedVersion: params.expectedVersion,
        correlationId: params.correlationId,
      });

    case OrderStatus.CLOSED:
      return closeOrder({
        actor: params.actor,
        orderId: params.orderId,
        expectedVersion: params.expectedVersion,
        correlationId: params.correlationId,
      });

    // Fulfilment states are reached by recording quantities, never by naming the state. Asking
    // for them directly is refused so the only route to "partially fulfilled" stays the one
    // backed by data.
    case OrderStatus.PARTIALLY_FULFILLED:
    case OrderStatus.FULFILLED:
      return {
        status: "validation_error",
        field: "status",
        reason: "Record the fulfilled quantities instead; this status is derived from them.",
      };

    default:
      return { status: "invalid_transition", from: OrderStatus.DRAFT, to: params.to };
  }
}

/**
 * CONFIRMED -> RESERVED (decision 36, owner 2026-10-14). Reserves every line's undelivered quantity
 * in the order's store, all or none, atomically per variant; the reservation is reviewed after 7
 * days rather than silently released. Refused with the short variant when stock isn't there.
 */
export async function reserveOrder(params: {
  actor: OrderActor;
  orderId: string;
  expectedVersion?: number;
  correlationId: string;
}): Promise<TransitionOrderResult> {
  if (!authorised(params.actor)) return { status: "forbidden" };
  const { tenantId } = params.actor;
  const order = await db.order.findFirst({
    where: { id: params.orderId, tenantId },
    select: {
      id: true,
      status: true,
      version: true,
      storeId: true,
      items: { select: { variantId: true, quantity: true, fulfilledQuantity: true } },
    },
  });
  if (!order) return { status: "not_found", what: "order" };
  if (!canTransition(order.status, OrderStatus.RESERVED)) {
    return { status: "invalid_transition", from: order.status, to: OrderStatus.RESERVED };
  }
  if (params.expectedVersion !== undefined && params.expectedVersion !== order.version) {
    return { status: "conflict", reason: "This order changed while you were working on it." };
  }
  const need = new Map<string, number>();
  for (const i of order.items) need.set(i.variantId, (need.get(i.variantId) ?? 0) + Math.max(0, i.quantity - i.fulfilledQuantity));

  try {
    const updated = await db.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: order.id, tenantId, version: order.version, status: order.status },
        data: { status: OrderStatus.RESERVED, version: { increment: 1 } },
      });
      if (claimed.count === 0) return null;
      await reserveLines(tx, {
        tenantId,
        storeId: order.storeId,
        source: "ORDER",
        sourceId: order.id,
        lines: [...need].map(([variantId, quantity]) => ({ variantId, quantity })),
        actorUserId: params.actor.userId,
        keyPrefix: `order:${order.id}:v${order.version}`,
      });
      return tx.order.findUniqueOrThrow({ where: { id: order.id }, select: ORDER_SELECT });
    });
    if (!updated) return { status: "conflict", reason: "This order changed while you were working on it." };
    await writeAuditLog({
      tenantId,
      userId: params.actor.userId,
      action: "OrderReserved",
      correlationId: params.correlationId,
      metadata: { orderId: order.id, lines: need.size },
    });
    return { status: "ok", order: updated };
  } catch (err) {
    if (err instanceof ReservationShortError) {
      return { status: "reservation_unavailable", variantId: err.variantId, available: err.available };
    }
    throw err;
  }
}

