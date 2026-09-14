import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import {
  isWindowCoherent,
  selectApplicableItem,
  validatePriceQuantity,
  validateUnitPrice,
  windowsOverlap,
  type PricedItem,
} from "@/server/pricing/priceSelection";

/**
 * Price lists, their items, and the resolution chain.
 *
 * ## The chain
 *
 *     customer's price list -> store's price list -> tenant default -> ProductVariant.priceMinor
 *
 * Each step **falls through on no applicable item**, not on "no list assigned". A customer with a
 * negotiated list that happens to carry no price for this variant, or whose only break starts at
 * 50 when 10 were asked for, or whose price expired yesterday, gets the store's price — not an
 * error and not nothing. Stopping at the first assigned list is the obvious bug here, so the
 * fall-through is tested at every step.
 *
 * ## Currency
 *
 * A list carries a currency and it is never converted. A list priced in one currency does not
 * apply to a store selling in another, and resolution says so explicitly rather than falling
 * through — silently skipping a mismatched list would be indistinguishable from "no price
 * configured", and the merchant would never learn their price list is being ignored. There is no
 * FX engine and this does not imply one.
 *
 * ## Authorization
 *
 * Reuses `canManageInventory` — OWNER, STORE_MANAGER or INVENTORY_MANAGER — the same people who
 * may define units and move stock. Setting what goods cost belongs with deciding what a carton
 * holds; it is emphatically not a till operation.
 *
 * ## What this is not
 *
 * No promotions, coupons, schemes, free quantity, loyalty, approval limits, discount engine, FX
 * or tax. Resolution answers one question with one number. `saleService` is untouched: wiring
 * this into checkout would change Sale semantics and belongs to the Order phase.
 */

export interface PricingActor {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
  membershipRole: string | null;
}

export type PricingFailure =
  | { status: "forbidden" }
  | { status: "not_found"; what: "price_list" | "variant" | "uom" | "customer" | "store" }
  | { status: "validation_error"; field: string; reason: string }
  | { status: "conflict"; reason: string };

function authorised(actor: PricingActor): boolean {
  return canManageInventory({ tenantRole: actor.tenantRole, membershipRole: actor.membershipRole });
}

export interface PriceListRow {
  id: string;
  name: string;
  currency: string;
  isActive: boolean;
}

export type CreatePriceListResult =
  | { status: "ok"; priceList: PriceListRow; existing: boolean }
  | PricingFailure;

/** Create a price list. A replayed create returns the existing one rather than failing. */
export async function createPriceList(params: {
  actor: PricingActor;
  name: string;
  currency: string;
  correlationId: string;
}): Promise<CreatePriceListResult> {
  if (!authorised(params.actor)) return { status: "forbidden" };

  const name = params.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 100) {
    return { status: "validation_error", field: "name", reason: "Give the price list a name." };
  }

  const currency = params.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return {
      status: "validation_error",
      field: "currency",
      reason: "Use the three-letter currency code, such as INR.",
    };
  }

  const existing = await db.priceList.findUnique({
    where: { tenantId_name: { tenantId: params.actor.tenantId, name } },
    select: { id: true, name: true, currency: true, isActive: true },
  });
  if (existing) return { status: "ok", priceList: existing, existing: true };

  try {
    const priceList = await db.priceList.create({
      data: { tenantId: params.actor.tenantId, name, currency },
      select: { id: true, name: true, currency: true, isActive: true },
    });

    await writeAuditLog({
      tenantId: params.actor.tenantId,
      userId: params.actor.userId,
      action: "PriceListCreated",
      correlationId: params.correlationId,
      metadata: { priceListId: priceList.id, name, currency },
    });

    return { status: "ok", priceList, existing: false };
  } catch (err) {
    // Lost a race on (tenantId, name). The winner's row is the answer.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.priceList.findUnique({
        where: { tenantId_name: { tenantId: params.actor.tenantId, name } },
        select: { id: true, name: true, currency: true, isActive: true },
      });
      if (raced) return { status: "ok", priceList: raced, existing: true };
    }
    throw err;
  }
}

export async function listPriceLists(tenantId: string): Promise<PriceListRow[]> {
  return db.priceList.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, currency: true, isActive: true },
  });
}

export interface PriceListItemRow {
  id: string;
  priceListId: string;
  variantId: string;
  uomId: string;
  minQuantity: number;
  unitPriceMinor: number;
  validFrom: Date | null;
  validTo: Date | null;
}

export type SetPriceResult =
  | { status: "ok"; item: PriceListItemRow; replaced: boolean }
  | PricingFailure;

/**
 * A stable key for one (list, variant, unit, break), used as a transaction-scoped advisory lock.
 * Two requests writing the same break serialise; everything else runs in parallel.
 */
function breakLockKey(priceListId: string, variantId: string, uomId: string, minQuantity: number) {
  return `${priceListId}:${variantId}:${uomId}:${minQuantity}`;
}

/**
 * Set a price for one quantity break.
 *
 * Two protections, deliberately at different layers:
 *
 * - **The database** enforces one row per (list, variant, unit, minQuantity) — the uniqueness the
 *   phase requires. Nothing can duplicate a break, whatever the calling code does.
 * - **The service** enforces that a second price for that break does not conflict *in time* with
 *   the existing one. PostgreSQL could express this as an exclusion constraint over a range type,
 *   but Prisma cannot model one and the migration would register as permanent schema drift,
 *   failing the CI drift gate. So it is checked here, inside a transaction that first takes an
 *   advisory lock on the break — which is what makes it safe under concurrency rather than a
 *   read-then-write race. The limitation is documented in docs/architecture/PRICING.md.
 *
 * Because the unique key is (list, variant, unit, break), a second price for the same break can
 * only ever *replace* the first. Overlap therefore reduces to: is the caller replacing a row whose
 * window overlaps theirs? When it does — the common case, two open-ended prices — replacement is
 * the intent and is allowed. When it does not, the two prices describe different periods that the
 * unique key would silently collapse into one, so it is refused.
 */
export async function setPriceListItem(params: {
  actor: PricingActor;
  priceListId: string;
  variantId: string;
  uomId: string;
  minQuantity?: number;
  unitPriceMinor: number;
  validFrom?: Date | null;
  validTo?: Date | null;
  correlationId: string;
}): Promise<SetPriceResult> {
  if (!authorised(params.actor)) return { status: "forbidden" };

  const minQuantity = params.minQuantity ?? 1;
  if (validatePriceQuantity(minQuantity)) {
    return {
      status: "validation_error",
      field: "minQuantity",
      reason: "A quantity break starts at a whole number of at least 1.",
    };
  }

  const priceError = validateUnitPrice(params.unitPriceMinor);
  if (priceError) {
    return {
      status: "validation_error",
      field: "unitPriceMinor",
      reason:
        priceError === "negative"
          ? "A price cannot be negative."
          : priceError === "too_large"
            ? "That price is implausibly large."
            : "A price is a whole number of minor units.",
    };
  }

  const validFrom = params.validFrom ?? null;
  const validTo = params.validTo ?? null;
  if (!isWindowCoherent(validFrom, validTo)) {
    return {
      status: "validation_error",
      field: "validTo",
      reason: "The validity window ends before it starts.",
    };
  }

  // Every reference resolved within the tenant: a foreign id is reported as not found, exactly
  // like one that does not exist.
  const priceList = await db.priceList.findFirst({
    where: { id: params.priceListId, tenantId: params.actor.tenantId },
    select: { id: true },
  });
  if (!priceList) return { status: "not_found", what: "price_list" };

  const variant = await db.productVariant.findFirst({
    where: { id: params.variantId, tenantId: params.actor.tenantId },
    select: { id: true },
  });
  if (!variant) return { status: "not_found", what: "variant" };

  const uom = await db.uom.findFirst({
    where: { id: params.uomId, tenantId: params.actor.tenantId },
    select: { id: true },
  });
  if (!uom) return { status: "not_found", what: "uom" };

  const key = breakLockKey(priceList.id, variant.id, uom.id, minQuantity);

  return db.$transaction(async (tx) => {
    // Serialise writers of this exact break. Held to the end of the transaction and released
    // automatically, so a crash cannot leak it.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;

    const existing = await tx.priceListItem.findUnique({
      where: {
        priceListId_variantId_uomId_minQuantity: {
          priceListId: priceList.id,
          variantId: variant.id,
          uomId: uom.id,
          minQuantity,
        },
      },
      select: { id: true, validFrom: true, validTo: true },
    });

    if (existing && !windowsOverlap(existing, { validFrom, validTo })) {
      return {
        status: "conflict" as const,
        reason:
          "A price for this break already exists for a different period. Remove or amend it first.",
      };
    }

    const item = await tx.priceListItem.upsert({
      where: {
        priceListId_variantId_uomId_minQuantity: {
          priceListId: priceList.id,
          variantId: variant.id,
          uomId: uom.id,
          minQuantity,
        },
      },
      create: {
        tenantId: params.actor.tenantId,
        priceListId: priceList.id,
        variantId: variant.id,
        uomId: uom.id,
        minQuantity,
        unitPriceMinor: params.unitPriceMinor,
        validFrom,
        validTo,
      },
      update: { unitPriceMinor: params.unitPriceMinor, validFrom, validTo },
      select: {
        id: true,
        priceListId: true,
        variantId: true,
        uomId: true,
        minQuantity: true,
        unitPriceMinor: true,
        validFrom: true,
        validTo: true,
      },
    });

    await writeAuditLog({
      tenantId: params.actor.tenantId,
      userId: params.actor.userId,
      action: existing ? "PriceListItemUpdated" : "PriceListItemCreated",
      correlationId: params.correlationId,
      metadata: {
        priceListId: priceList.id,
        variantId: variant.id,
        uomId: uom.id,
        minQuantity,
        unitPriceMinor: params.unitPriceMinor,
      },
    });

    return { status: "ok" as const, item, replaced: Boolean(existing) };
  });
}

export type ListItemsResult = { status: "ok"; items: PriceListItemRow[] } | PricingFailure;

export async function listPriceListItems(params: {
  tenantId: string;
  priceListId: string;
}): Promise<ListItemsResult> {
  const priceList = await db.priceList.findFirst({
    where: { id: params.priceListId, tenantId: params.tenantId },
    select: { id: true },
  });
  if (!priceList) return { status: "not_found", what: "price_list" };

  const items = await db.priceListItem.findMany({
    where: { tenantId: params.tenantId, priceListId: priceList.id },
    orderBy: [{ variantId: "asc" }, { minQuantity: "asc" }],
    select: {
      id: true,
      priceListId: true,
      variantId: true,
      uomId: true,
      minQuantity: true,
      unitPriceMinor: true,
      validFrom: true,
      validTo: true,
    },
  });

  return { status: "ok", items };
}

export type AssignResult = { status: "ok"; priceListId: string | null } | PricingFailure;

/** Resolve a price list within the tenant. `null` clears an assignment. */
async function resolveAssignableList(tenantId: string, priceListId: string) {
  return db.priceList.findFirst({
    where: { id: priceListId, tenantId },
    select: { id: true, currency: true, isActive: true },
  });
}

export async function assignCustomerPriceList(params: {
  actor: PricingActor;
  customerId: string;
  priceListId: string | null;
  correlationId: string;
}): Promise<AssignResult> {
  if (!authorised(params.actor)) return { status: "forbidden" };

  const customer = await db.customer.findFirst({
    where: { id: params.customerId, tenantId: params.actor.tenantId },
    select: { id: true },
  });
  if (!customer) return { status: "not_found", what: "customer" };

  if (params.priceListId !== null) {
    const list = await resolveAssignableList(params.actor.tenantId, params.priceListId);
    if (!list) return { status: "not_found", what: "price_list" };
  }

  await db.customer.update({
    where: { id: customer.id },
    data: { priceListId: params.priceListId },
  });

  await writeAuditLog({
    tenantId: params.actor.tenantId,
    userId: params.actor.userId,
    action: "CustomerPriceListAssigned",
    correlationId: params.correlationId,
    metadata: { customerId: customer.id, priceListId: params.priceListId },
  });

  return { status: "ok", priceListId: params.priceListId };
}

/**
 * Assign a price list to a store.
 *
 * Currency is checked here as well as at resolution. A store sells in one currency, so a list in
 * another can never apply to it — catching that at assignment tells the merchant immediately
 * rather than at the till.
 */
export async function assignStorePriceList(params: {
  actor: PricingActor;
  storeId: string;
  priceListId: string | null;
  correlationId: string;
}): Promise<AssignResult> {
  if (!authorised(params.actor)) return { status: "forbidden" };

  const store = await db.store.findFirst({
    where: { id: params.storeId, tenantId: params.actor.tenantId },
    select: { id: true, currency: true },
  });
  if (!store) return { status: "not_found", what: "store" };

  if (params.priceListId !== null) {
    const list = await resolveAssignableList(params.actor.tenantId, params.priceListId);
    if (!list) return { status: "not_found", what: "price_list" };

    if (list.currency !== store.currency.trim().toUpperCase()) {
      return {
        status: "validation_error",
        field: "priceListId",
        reason: `That price list is in ${list.currency} and this store sells in ${store.currency}. Prices are never converted.`,
      };
    }
  }

  await db.store.update({ where: { id: store.id }, data: { priceListId: params.priceListId } });

  await writeAuditLog({
    tenantId: params.actor.tenantId,
    userId: params.actor.userId,
    action: "StorePriceListAssigned",
    correlationId: params.correlationId,
    metadata: { storeId: store.id, priceListId: params.priceListId },
  });

  return { status: "ok", priceListId: params.priceListId };
}

/** The tenant's fallback list. A pointer, so there can only ever be one. */
export async function setTenantDefaultPriceList(params: {
  actor: PricingActor;
  priceListId: string | null;
  correlationId: string;
}): Promise<AssignResult> {
  if (!authorised(params.actor)) return { status: "forbidden" };

  if (params.priceListId !== null) {
    const list = await resolveAssignableList(params.actor.tenantId, params.priceListId);
    if (!list) return { status: "not_found", what: "price_list" };
  }

  await db.tenant.update({
    where: { id: params.actor.tenantId },
    data: { defaultPriceListId: params.priceListId },
  });

  await writeAuditLog({
    tenantId: params.actor.tenantId,
    userId: params.actor.userId,
    action: "TenantDefaultPriceListSet",
    correlationId: params.correlationId,
    metadata: { priceListId: params.priceListId },
  });

  return { status: "ok", priceListId: params.priceListId };
}

/** Where a resolved price came from. Returned so a caller can show the merchant why. */
export type PriceSource = "CUSTOMER_LIST" | "STORE_LIST" | "TENANT_DEFAULT_LIST" | "VARIANT_BASE";

export type ResolvePriceResult =
  | {
      status: "ok";
      unitPriceMinor: number;
      currency: string;
      source: PriceSource;
      priceListId: string | null;
      minQuantity: number;
    }
  | PricingFailure
  | {
      status: "currency_mismatch";
      priceListId: string;
      listCurrency: string;
      storeCurrency: string;
    }
  | { status: "no_price" };

interface Candidate {
  source: PriceSource;
  priceListId: string;
  currency: string;
}

/**
 * Resolve the price for one variant, in one unit, at one quantity, at one instant.
 *
 * Server-authoritative by construction: the caller supplies ids and a quantity, never a price.
 */
export async function resolvePrice(params: {
  tenantId: string;
  storeId: string;
  variantId: string;
  uomId: string;
  quantity: number;
  customerId?: string | null;
  at?: Date;
}): Promise<ResolvePriceResult> {
  if (validatePriceQuantity(params.quantity)) {
    return {
      status: "validation_error",
      field: "quantity",
      reason: "Enter a whole quantity of at least 1.",
    };
  }
  const at = params.at ?? new Date();

  const store = await db.store.findFirst({
    where: { id: params.storeId, tenantId: params.tenantId },
    select: { id: true, currency: true, priceListId: true },
  });
  if (!store) return { status: "not_found", what: "store" };

  const variant = await db.productVariant.findFirst({
    where: { id: params.variantId, tenantId: params.tenantId },
    select: { id: true, priceMinor: true, product: { select: { baseUomId: true } } },
  });
  if (!variant) return { status: "not_found", what: "variant" };

  const uom = await db.uom.findFirst({
    where: { id: params.uomId, tenantId: params.tenantId },
    select: { id: true },
  });
  if (!uom) return { status: "not_found", what: "uom" };

  const storeCurrency = store.currency.trim().toUpperCase();

  // Build the chain in priority order, skipping steps that are simply not configured.
  const candidates: Candidate[] = [];

  if (params.customerId) {
    const customer = await db.customer.findFirst({
      where: { id: params.customerId, tenantId: params.tenantId },
      select: { id: true, priceList: { select: { id: true, currency: true, isActive: true } } },
    });
    if (!customer) return { status: "not_found", what: "customer" };
    if (customer.priceList?.isActive) {
      candidates.push({
        source: "CUSTOMER_LIST",
        priceListId: customer.priceList.id,
        currency: customer.priceList.currency,
      });
    }
  }

  if (store.priceListId) {
    const list = await db.priceList.findFirst({
      where: { id: store.priceListId, tenantId: params.tenantId, isActive: true },
      select: { id: true, currency: true },
    });
    if (list) {
      candidates.push({ source: "STORE_LIST", priceListId: list.id, currency: list.currency });
    }
  }

  const tenant = await db.tenant.findUnique({
    where: { id: params.tenantId },
    select: { defaultPriceList: { select: { id: true, currency: true, isActive: true } } },
  });
  if (tenant?.defaultPriceList?.isActive) {
    candidates.push({
      source: "TENANT_DEFAULT_LIST",
      priceListId: tenant.defaultPriceList.id,
      currency: tenant.defaultPriceList.currency,
    });
  }

  for (const candidate of candidates) {
    // Refused, not skipped: a merchant whose price list is quietly ignored because of a currency
    // mismatch would have no way to find out.
    if (candidate.currency !== storeCurrency) {
      return {
        status: "currency_mismatch",
        priceListId: candidate.priceListId,
        listCurrency: candidate.currency,
        storeCurrency,
      };
    }

    const items: PricedItem[] = await db.priceListItem.findMany({
      where: {
        tenantId: params.tenantId,
        priceListId: candidate.priceListId,
        variantId: variant.id,
        uomId: uom.id,
      },
      select: { id: true, minQuantity: true, unitPriceMinor: true, validFrom: true, validTo: true },
    });

    const item = selectApplicableItem(items, params.quantity, at);
    // No applicable item is a fall-through, not an answer. This is the step that makes an
    // assigned-but-incomplete list behave correctly.
    if (!item) continue;

    return {
      status: "ok",
      unitPriceMinor: item.unitPriceMinor,
      currency: candidate.currency,
      source: candidate.source,
      priceListId: candidate.priceListId,
      minQuantity: item.minQuantity,
    };
  }

  // Last resort: the variant's own price. It is denominated in the product's base unit, so it can
  // only answer a request in that unit — quoting a piece price for a carton would be a silent
  // conversion, which is what this phase refuses to do everywhere else.
  const baseUomId = variant.product.baseUomId;
  if (baseUomId === null || baseUomId === uom.id) {
    return {
      status: "ok",
      unitPriceMinor: variant.priceMinor,
      currency: storeCurrency,
      source: "VARIANT_BASE",
      priceListId: null,
      minQuantity: 1,
    };
  }

  return { status: "no_price" };
}
