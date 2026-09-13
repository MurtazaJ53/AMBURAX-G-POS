import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import {
  convertQuantity,
  validateFactor,
  type ConversionEdge,
  type ConversionResult,
  type UomLike,
} from "@/server/uom/conversion";

/**
 * The five operations the UOM foundation needs: define a unit, list units, define a conversion,
 * resolve one, and tell a product which unit it is counted in.
 *
 * Not an admin system. There is no edit, delete, merge or archive — a unit that turns out to be
 * wrong is a data problem to solve when someone actually has one, and deleting a unit that
 * products and conversions point at is a referential question this phase has no reason to answer.
 *
 * Authorization reuses `canManageInventory` rather than inventing a second vocabulary: the people
 * who may receive and adjust stock are the people who may say what a carton holds. Both are the
 * question "may this person change what the system believes about goods".
 *
 * Tenant scoping is the same discipline as everywhere else — `tenantId` comes from the resolved
 * session, and a unit belonging to another tenant is reported identically to one that does not
 * exist, so the API cannot be used to discover another tenant's catalogue.
 */

export interface UomActor {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
  /** The caller's role at the tenant's store, as resolved by `resolvePosContext`. */
  membershipRole: string | null;
}

export type UomFailure =
  | { status: "forbidden" }
  | { status: "not_found"; what: "uom" | "product" }
  | { status: "validation_error"; reason: string }
  | { status: "conflict"; reason: string };

export interface UomRow {
  id: string;
  code: string;
  name: string;
  decimalPlaces: number;
  isActive: boolean;
}

function authorised(actor: UomActor): boolean {
  return canManageInventory({ tenantRole: actor.tenantRole, membershipRole: actor.membershipRole });
}

/** PCS is created for every tenant by the migration; the code is the stable way to find it. */
export const BASE_UOM_CODE = "PCS";

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,15}$/;

export type CreateUomResult = { status: "ok"; uom: UomRow; existing: boolean } | UomFailure;

/**
 * Define a unit.
 *
 * Codes are uppercased and constrained to a short symbol, because they are operator-facing and
 * compared by humans: "pcs", "Pcs" and "PCS" must not become three units.
 *
 * Creating a unit that already exists returns the existing one rather than an error. A retried
 * request and a double-click are the same event, and the `(tenantId, code)` unique index makes
 * the database the arbiter when two of them race.
 */
export async function createUom(params: {
  actor: UomActor;
  code: string;
  name: string;
  decimalPlaces?: number;
  correlationId: string;
}): Promise<CreateUomResult> {
  if (!authorised(params.actor)) return { status: "forbidden" };

  const code = params.code.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    return {
      status: "validation_error",
      reason: "A unit code is 1-16 characters, starting with a letter: PCS, PACK, DOZEN.",
    };
  }

  const name = params.name.trim();
  if (name.length < 2 || name.length > 100) {
    return { status: "validation_error", reason: "Give the unit a name." };
  }

  const decimalPlaces = params.decimalPlaces ?? 0;
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 3) {
    return { status: "validation_error", reason: "Decimal places must be between 0 and 3." };
  }

  const existing = await db.uom.findUnique({
    where: { tenantId_code: { tenantId: params.actor.tenantId, code } },
    select: { id: true, code: true, name: true, decimalPlaces: true, isActive: true },
  });
  if (existing) return { status: "ok", uom: existing, existing: true };

  try {
    const uom = await db.uom.create({
      data: { tenantId: params.actor.tenantId, code, name, decimalPlaces },
      select: { id: true, code: true, name: true, decimalPlaces: true, isActive: true },
    });

    await writeAuditLog({
      tenantId: params.actor.tenantId,
      userId: params.actor.userId,
      action: "UomCreated",
      correlationId: params.correlationId,
      metadata: { uomId: uom.id, code, decimalPlaces },
    });

    return { status: "ok", uom, existing: false };
  } catch (err) {
    // Lost the race against a concurrent create of the same code. The winner's row is the answer;
    // the caller cannot tell which request created it, and should not care.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.uom.findUnique({
        where: { tenantId_code: { tenantId: params.actor.tenantId, code } },
        select: { id: true, code: true, name: true, decimalPlaces: true, isActive: true },
      });
      if (raced) return { status: "ok", uom: raced, existing: true };
    }
    throw err;
  }
}

/** Every unit this tenant has defined, in code order. */
export async function listUoms(tenantId: string): Promise<UomRow[]> {
  return db.uom.findMany({
    where: { tenantId },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, decimalPlaces: true, isActive: true },
  });
}

export interface ConversionRow {
  id: string;
  fromUomId: string;
  toUomId: string;
  factor: number;
}

export type CreateConversionResult =
  | { status: "ok"; conversion: ConversionRow; existing: boolean }
  | UomFailure;

/**
 * Define "one `fromUom` contains `factor` of `toUom`".
 *
 * Refuses three things, each for its own reason:
 *
 * - **Same unit on both sides.** `1 PCS = 2 PCS` is not a conversion, it is a contradiction.
 * - **A factor below two.** One means the units are synonyms, and a fractional factor would
 *   produce quantities nothing in this system can store.
 * - **A reverse edge that already exists.** If `DOZEN -> PCS` is defined, `PCS -> DOZEN` is
 *   already derivable by division; storing it too would let the two disagree. That check is
 *   application-level — see the phase documentation for the constraint that would make it
 *   structural.
 */
export async function createUomConversion(params: {
  actor: UomActor;
  fromUomId: string;
  toUomId: string;
  factor: number;
  correlationId: string;
}): Promise<CreateConversionResult> {
  if (!authorised(params.actor)) return { status: "forbidden" };

  if (params.fromUomId === params.toUomId) {
    return { status: "validation_error", reason: "A unit cannot convert to itself." };
  }

  const factorError = validateFactor(params.factor);
  if (factorError) {
    return {
      status: "validation_error",
      reason:
        factorError === "too_small"
          ? "A conversion factor must be a whole number of at least 2."
          : factorError === "too_large"
            ? "That conversion factor is implausibly large."
            : "A conversion factor must be a whole number.",
    };
  }

  // Both units resolved within the tenant. A foreign unit is reported as not found, exactly like
  // a nonexistent one.
  const units = await db.uom.findMany({
    where: { tenantId: params.actor.tenantId, id: { in: [params.fromUomId, params.toUomId] } },
    select: { id: true },
  });
  if (units.length !== 2) return { status: "not_found", what: "uom" };

  const reverse = await db.uomConversion.findUnique({
    where: {
      tenantId_fromUomId_toUomId: {
        tenantId: params.actor.tenantId,
        fromUomId: params.toUomId,
        toUomId: params.fromUomId,
      },
    },
    select: { id: true },
  });
  if (reverse) {
    return {
      status: "conflict",
      reason: "The reverse conversion is already defined; it is derived by division.",
    };
  }

  const existing = await db.uomConversion.findUnique({
    where: {
      tenantId_fromUomId_toUomId: {
        tenantId: params.actor.tenantId,
        fromUomId: params.fromUomId,
        toUomId: params.toUomId,
      },
    },
    select: { id: true, fromUomId: true, toUomId: true, factor: true },
  });
  if (existing) {
    // A replay of the same definition is success; a different factor for the same pair is a
    // genuine conflict, because silently overwriting it would change every future conversion.
    if (existing.factor === params.factor) {
      return { status: "ok", conversion: existing, existing: true };
    }
    return {
      status: "conflict",
      reason: `That conversion is already defined with a factor of ${existing.factor}.`,
    };
  }

  try {
    const conversion = await db.uomConversion.create({
      data: {
        tenantId: params.actor.tenantId,
        fromUomId: params.fromUomId,
        toUomId: params.toUomId,
        factor: params.factor,
      },
      select: { id: true, fromUomId: true, toUomId: true, factor: true },
    });

    await writeAuditLog({
      tenantId: params.actor.tenantId,
      userId: params.actor.userId,
      action: "UomConversionCreated",
      correlationId: params.correlationId,
      metadata: {
        conversionId: conversion.id,
        fromUomId: params.fromUomId,
        toUomId: params.toUomId,
        factor: params.factor,
      },
    });

    return { status: "ok", conversion, existing: false };
  } catch (err) {
    // The unique index decided a concurrent race. Whoever lost reports the winner's row, which is
    // why the pre-check above is a courtesy rather than the guarantee.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.uomConversion.findUnique({
        where: {
          tenantId_fromUomId_toUomId: {
            tenantId: params.actor.tenantId,
            fromUomId: params.fromUomId,
            toUomId: params.toUomId,
          },
        },
        select: { id: true, fromUomId: true, toUomId: true, factor: true },
      });
      if (raced) {
        return raced.factor === params.factor
          ? { status: "ok", conversion: raced, existing: true }
          : {
              status: "conflict",
              reason: `That conversion is already defined with a factor of ${raced.factor}.`,
            };
      }
    }
    throw err;
  }
}

/** Every conversion this tenant has defined. */
export async function listUomConversions(tenantId: string): Promise<ConversionRow[]> {
  return db.uomConversion.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true, fromUomId: true, toUomId: true, factor: true },
  });
}

export type ResolveConversionResult =
  | { status: "ok"; quantity: number; fromCode: string; toCode: string }
  | UomFailure
  | Exclude<ConversionResult, { status: "ok" }>;

/**
 * Convert a quantity between two of this tenant's units.
 *
 * Reads the tenant's units and its whole conversion set, then hands both to the pure arithmetic
 * in `conversion.ts`. The set is small — a garment business has a handful of units — so fetching
 * all of it is simpler and more predictable than a recursive query, and keeps the arithmetic
 * testable without a database.
 */
export async function resolveConversion(params: {
  tenantId: string;
  quantity: number;
  fromUomId: string;
  toUomId: string;
}): Promise<ResolveConversionResult> {
  const units = await db.uom.findMany({
    where: { tenantId: params.tenantId, id: { in: [params.fromUomId, params.toUomId] } },
    select: { id: true, code: true, decimalPlaces: true },
  });

  const from = units.find((u) => u.id === params.fromUomId);
  const to = units.find((u) => u.id === params.toUomId);
  // Covers the same-id case too: one row comes back and both lookups find it.
  if (!from || !to) return { status: "not_found", what: "uom" };

  const edges: ConversionEdge[] = await db.uomConversion.findMany({
    where: { tenantId: params.tenantId },
    select: { fromUomId: true, toUomId: true, factor: true },
  });

  const result = convertQuantity({
    quantity: params.quantity,
    from: from as UomLike,
    to: to as UomLike,
    edges,
  });

  if (result.status !== "ok") return result;
  return { status: "ok", quantity: result.quantity, fromCode: from.code, toCode: to.code };
}

export type AssignBaseUomResult =
  | { status: "ok"; productId: string; baseUomId: string }
  | UomFailure;

/**
 * Tell a product which unit its quantities are counted in.
 *
 * Deliberately refuses a unit that declares decimal places: every quantity column that would hold
 * this product's numbers is an integer, so a product based in METRE would be a product whose
 * stock cannot be recorded. Saying so here is better than discovering it at the till.
 *
 * Both the product and the unit are resolved within the tenant, and the composite foreign key
 * `(baseUomId, tenantId)` means PostgreSQL rejects a cross-tenant pairing even if this code were
 * wrong.
 */
export async function assignProductBaseUom(params: {
  actor: UomActor;
  productId: string;
  uomId: string;
  correlationId: string;
}): Promise<AssignBaseUomResult> {
  if (!authorised(params.actor)) return { status: "forbidden" };

  const product = await db.product.findFirst({
    where: { id: params.productId, tenantId: params.actor.tenantId },
    select: { id: true },
  });
  if (!product) return { status: "not_found", what: "product" };

  const uom = await db.uom.findFirst({
    where: { id: params.uomId, tenantId: params.actor.tenantId },
    select: { id: true, code: true, decimalPlaces: true },
  });
  if (!uom) return { status: "not_found", what: "uom" };

  if (uom.decimalPlaces > 0) {
    return {
      status: "validation_error",
      reason: `${uom.code} allows decimals, and stock quantities are whole numbers in this system.`,
    };
  }

  await db.product.update({
    where: { id: product.id },
    data: { baseUomId: uom.id },
  });

  await writeAuditLog({
    tenantId: params.actor.tenantId,
    userId: params.actor.userId,
    action: "ProductBaseUomAssigned",
    correlationId: params.correlationId,
    metadata: { productId: product.id, uomId: uom.id, code: uom.code },
  });

  return { status: "ok", productId: product.id, baseUomId: uom.id };
}
