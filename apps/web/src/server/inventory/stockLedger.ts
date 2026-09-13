import { Prisma, type StockMovementType } from "@prisma/client";

/**
 * The one place stock changes. Everything else — receipts, adjustments, stock takes, the POS
 * decrement — goes through `applyStockMovement`.
 *
 * The design rule, enforced by the type signature exactly as the outbox producer enforces its
 * own: this function accepts a `Prisma.TransactionClient` and nothing else. It cannot be
 * called with the global `db` client, so it is impossible to write a movement outside the
 * transaction that produced the fact it describes, or to change a balance without recording
 * why it changed.
 *
 * ## The projection invariant
 *
 *   for every (storeId, variantId):  stock_levels.quantity = SUM(stock_movements.quantityDelta)
 *
 * Three things hold it up, and all three are load-bearing:
 *
 * 1. **One writer.** The balance update and the movement insert happen here, in one pair of
 *    statements, inside the caller's transaction. Nothing else in the codebase writes
 *    `stock_levels` — `server/sales/saleService.ts` used to, and now calls this instead.
 * 2. **No read-modify-write.** The balance is updated with `quantity = quantity + delta`
 *    computed by PostgreSQL, never by reading a number into JavaScript and writing it back.
 *    A read-modify-write is exactly where concurrent updates get lost.
 * 3. **Integer arithmetic only.** Deltas and balances are `Int`, matching the quantity
 *    contract `validateQuantity` already enforces. No floating point is involved anywhere in
 *    the ledger, so the sum is exact by construction rather than by rounding luck.
 *
 * The migration that created the table verifies this invariant over the backfilled data
 * before committing, and `findProjectionMismatches` below lets a test or a future
 * reconciliation sweep check it again at any time.
 */

/** What a caller must say about a stock change. */
export interface StockMovementInput {
  tenantId: string;
  storeId: string;
  variantId: string;
  type: StockMovementType;
  /** Signed: positive adds, negative removes. Zero is rejected — a no-op is not a movement. */
  quantityDelta: number;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  actorUserId?: string | null;
  /**
   * Deterministic, derived from the business fact. A retried operation collides on
   * `@@unique([tenantId, idempotencyKey])` rather than counting the stock twice.
   */
  idempotencyKey: string;
}

export interface AppliedMovement {
  movementId: string;
  balanceAfter: number;
}

/**
 * Upper bound on a single movement, mirroring `MAX_LINE_QUANTITY` in `saleTotals.ts`.
 *
 * Deliberately not that same constant imported: that one bounds a till line, this one bounds
 * a stockroom operation, and a receipt of a thousand cartons is legitimate where a single
 * sale line of the same size is a typo. They are allowed to diverge; sharing the symbol would
 * couple them silently.
 */
export const MAX_MOVEMENT_QUANTITY = 1_000_000;

export type MovementQuantityError = "not_an_integer" | "zero" | "too_large";

/**
 * Validate rather than coerce, for the reason `validateQuantity` already gives: rounding a
 * fractional quantity or accepting a NaN quietly corrupts a balance that money depends on.
 */
export function validateMovementQuantity(delta: unknown): MovementQuantityError | null {
  if (typeof delta !== "number" || !Number.isFinite(delta) || !Number.isInteger(delta)) {
    return "not_an_integer";
  }
  if (delta === 0) return "zero";
  if (Math.abs(delta) > MAX_MOVEMENT_QUANTITY) return "too_large";
  return null;
}

export class InvalidMovementQuantityError extends Error {
  constructor(readonly reason: MovementQuantityError) {
    super(`Invalid stock movement quantity: ${reason}`);
    this.name = "InvalidMovementQuantityError";
  }
}

/**
 * Apply one movement inside the caller's transaction: change the balance, record why.
 *
 * Order matters. The balance is updated **first**, by a single atomic statement that returns
 * the new value, and that returned value is what the movement records as `balanceAfter`.
 * Doing it the other way round — insert the movement, then update the balance — would let two
 * concurrent movements each record a `balanceAfter` that was never true, because neither
 * would know about the other's increment.
 *
 * `INSERT ... ON CONFLICT DO UPDATE` rather than Prisma's `upsert`: it is one statement, so
 * there is no window between "no row exists" and "create one" for a parallel transaction to
 * slip into. Under concurrency Prisma's upsert can surface a unique violation instead; this
 * cannot.
 *
 * Negative balances are permitted, deliberately. `StockLevel.quantity` is signed precisely so
 * drift stays visible, and clamping at zero would hide the exact condition a reconciliation
 * sweep exists to find. Refusing to oversell is a policy decision for the caller, not
 * something the ledger should enforce by lying about the number.
 */
export async function applyStockMovement(
  tx: Prisma.TransactionClient,
  input: StockMovementInput,
): Promise<AppliedMovement> {
  const invalid = validateMovementQuantity(input.quantityDelta);
  if (invalid) throw new InvalidMovementQuantityError(invalid);

  // One statement: create the level at the delta, or add the delta to the existing one.
  // PostgreSQL computes the arithmetic and holds the row lock, so two concurrent callers
  // serialise here and neither loses its update.
  const rows = await tx.$queryRaw<{ quantity: number }[]>`
    INSERT INTO "stock_levels" ("id", "tenantId", "storeId", "variantId", "quantity", "updatedAt")
    VALUES (
      ${`sl_${input.storeId}_${input.variantId}`},
      ${input.tenantId},
      ${input.storeId},
      ${input.variantId},
      ${input.quantityDelta},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("storeId", "variantId") DO UPDATE
      SET "quantity"  = "stock_levels"."quantity" + ${input.quantityDelta},
          "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "quantity"
  `;

  const balanceAfter = rows[0]?.quantity;
  if (balanceAfter === undefined) {
    // Unreachable in practice: ON CONFLICT DO UPDATE always returns a row. Treated as a bug
    // rather than defaulted to zero, because a silently wrong balance is worse than a crash.
    throw new Error("stock ledger: balance update returned no row");
  }

  const movement = await tx.stockMovement.create({
    data: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      variantId: input.variantId,
      type: input.type,
      quantityDelta: input.quantityDelta,
      balanceAfter,
      reason: input.reason ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      actorUserId: input.actorUserId ?? null,
      idempotencyKey: input.idempotencyKey,
    },
    select: { id: true },
  });

  return { movementId: movement.id, balanceAfter };
}

/** Deterministic keys, so a retry of the same business fact collides instead of duplicating. */
export const movementKey = {
  /** One movement per (sale, variant). A replayed sale returns early and never reaches here. */
  sale: (saleId: string, variantId: string) => `SALE:${saleId}:${variantId}`,
  /** Client-supplied request key, namespaced so it cannot collide with another operation. */
  receipt: (requestKey: string) => `RECEIPT:${requestKey}`,
  adjustment: (requestKey: string) => `ADJUSTMENT:${requestKey}`,
  stockTake: (requestKey: string) => `STOCK_TAKE:${requestKey}`,
};

export interface ProjectionMismatch {
  storeId: string;
  variantId: string;
  levelQuantity: number;
  movementSum: number;
}

/**
 * Check the projection invariant across a tenant, or across everything when no tenant is
 * given. Returns the rows that disagree — empty means the ledger and the balances agree.
 *
 * This is what makes the invariant testable rather than merely asserted. It exists for tests
 * and for a future reconciliation sweep; no request path calls it, because checking on every
 * write would reintroduce the read-modify-write the design avoids.
 */
export async function findProjectionMismatches(
  client: { $queryRaw: Prisma.TransactionClient["$queryRaw"] },
  tenantId?: string,
): Promise<ProjectionMismatch[]> {
  const tenantFilter = tenantId ? Prisma.sql`WHERE sl."tenantId" = ${tenantId}` : Prisma.empty;

  return client.$queryRaw<ProjectionMismatch[]>`
    SELECT sl."storeId"       AS "storeId",
           sl."variantId"     AS "variantId",
           sl."quantity"::int AS "levelQuantity",
           COALESCE((
             SELECT SUM(m."quantityDelta")
               FROM "stock_movements" m
              WHERE m."storeId" = sl."storeId" AND m."variantId" = sl."variantId"
           ), 0)::int          AS "movementSum"
      FROM "stock_levels" sl
      ${tenantFilter}
     GROUP BY sl."id", sl."storeId", sl."variantId", sl."quantity"
    HAVING sl."quantity" <> COALESCE((
             SELECT SUM(m."quantityDelta")
               FROM "stock_movements" m
              WHERE m."storeId" = sl."storeId" AND m."variantId" = sl."variantId"
           ), 0)
  `;
}
