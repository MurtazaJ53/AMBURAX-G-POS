# AMBURAX — Inventory Foundation

Established by P1-8B, 2026-09-13. Migration `20260913150000_add_stock_movements`.

## Authority

| | |
|---|---|
| **`StockMovement`** | **Authoritative.** The append-only ledger of every stock change. |
| **`StockLevel`** | **Projection.** A cached running balance, derived from movements. |

There is no dual authority and no dual-write: `StockLevel` is not maintained by a second code
path that could drift from the ledger. Both are written by one function, `applyStockMovement`,
in one transaction, and the level only ever moves by a delta that a movement records. If they
ever disagree, the movements are right.

**What changed.** Before P1-8B the only stock writer in the entire codebase was the decrement
inside `createSale`. Stock could fall and never rise, and `stock_levels.quantity` was a bare
number with no provenance — nothing recorded who changed a balance, when, why, or from what.

## The projection invariant

```
for every (storeId, variantId):  stock_levels.quantity = SUM(stock_movements.quantityDelta)
```

Three things hold it up:

1. **One writer.** `applyStockMovement` accepts a `Prisma.TransactionClient` and nothing else,
   so it cannot be called with the global client — the same type-level enforcement the outbox
   producer uses. Nothing else writes `stock_levels`.
2. **No read-modify-write.** The balance moves via `quantity = quantity + delta` computed by
   PostgreSQL, never by reading a number into JavaScript and writing it back.
3. **Integer arithmetic.** Deltas and balances are `Int`, matching the existing
   `validateQuantity` contract. No floating point is involved, so the sum is exact by
   construction. Decimal quantities are deferred to the UOM phase (P1-8C) as a deliberate type
   change.

`findProjectionMismatches(client, tenantId?)` checks the invariant on demand — used by tests
and available to a future reconciliation sweep. No request path calls it, because checking on
every write would reintroduce the race the design avoids.

## Concurrency

The balance update is a single `INSERT ... ON CONFLICT ("storeId","variantId") DO UPDATE`
statement that returns the new quantity, and that returned value is what the movement records
as `balanceAfter`. Consequences:

- Two concurrent movements serialise on PostgreSQL's row lock; neither update is lost.
- Two first-ever movements for the same pair cannot both create the row — the loser updates
  rather than failing on the unique index, which is why this is not Prisma's `upsert`.
- The balance is updated **before** the movement is inserted, so `balanceAfter` is always a
  value that actually existed.

Proven in `apps/web/src/test-integration/inventory.test.ts` against real PostgreSQL: ten
simultaneous receipts of 10 land as exactly +100, mixed concurrent receipts and adjustments
reconcile, and a transaction that throws after a movement leaves neither the movement nor the
balance change.

## Opening-balance backfill

The migration gives every pre-existing balance a history:

1. Add the table and its constraints.
2. Insert one `OPENING_BALANCE` movement per `stock_levels` row with a non-zero quantity,
   taking `tenantId` from the **store** (FK-enforced) rather than from `stock_levels.tenantId`
   (which has no foreign key — a known P2 gap, invariant I-4).
3. Raise and roll back if any non-zero balance could not be attributed, listing the offending
   ids rather than guessing a tenant.
4. Raise and roll back if the resulting projection does not equal the original balances.

A zero balance gets no movement: the sum of an empty set is already zero, and a zero-delta row
would add noise to every future ledger read. Applied to the development database, 50 stock
levels produced 47 opening movements (3 were zero) and reconciled.

## Movement types

`OPENING_BALANCE` · `RECEIPT` · `SALE` · `ADJUSTMENT` · `STOCK_TAKE`

Deliberately short. Purchase receipts, inter-store transfers, manufacturing consumption and
job-work issues each need an entity that does not exist yet (supplier, warehouse, work order);
naming them now would reserve vocabulary for systems nobody has built.

## Operations

| Operation | Service | API | Notes |
|---|---|---|---|
| Receive | `receiveStock` | `POST /api/v1/inventory/receipts` | Positive only. Not a purchase receipt — no supplier or PO exists. |
| Adjust | `adjustStock` | `POST /api/v1/inventory/adjustments` | Signed, reason required. |
| Stock take | `recordStockTake` | `POST /api/v1/inventory/stock-takes` | Caller sends the counted quantity; the server derives the delta. A matching count writes nothing. |
| Sale | `createSale` | existing POS path | Now routed through the ledger; POS semantics unchanged. |

Authorization is `canManageInventory`: tenant `OWNER`, or a store membership of
`STORE_MANAGER` / `INVENTORY_MANAGER`. Deliberately narrower than selling — a cashier who
could write receipts and adjustments could conceal theft.

Every operation resolves the store and variant **scoped to the session's tenant**, so a foreign
id and a nonexistent one return the same `not_found`: no cross-tenant existence oracle.
`tenantId` is never read from a request body.

Idempotency is a client-supplied `requestKey`, namespaced per operation and unique per tenant
(`@@unique([tenantId, idempotencyKey])`), checked once as a fast path and enforced by the index
when two retries race.

## Deliberately not built

Negative balances are permitted — `StockLevel.quantity` is signed so drift stays visible, and
the POS has never blocked overselling. Adding an oversell guard is a product decision, not a
side effect of this phase. No outbox event is emitted: `StockChanged`/`StockAdjusted` are
PLANNED in EVENTS.md with no producer and no consumer. No warehouse entity, no supplier, no
transfer, no purchasing — all deferred with their phases.

## Remaining P2 (invariant I-4)

`stock_movements` uses composite foreign keys from the start, so a movement's store and variant
must belong to its tenant. `stock_levels` still does not: its `tenantId` has no foreign key at
all. Closing that belongs to P1-8H with the rest of the queue.
