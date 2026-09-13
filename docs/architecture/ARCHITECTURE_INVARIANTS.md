# AMBURAX — Architecture Invariants

Frozen 2026-09-13 (P1-7). These are the rules that outlive any single feature. Each one
states what it forbids, where it is enforced today, and what would make the enforcement
stronger. An invariant with no enforcement mechanism is a hope, so each is labelled.

Enforcement levels, weakest to strongest:

| Level | Meaning |
|---|---|
| **CONVENTION** | Stated in a document. Nothing checks it. |
| **REVIEW** | A reviewer is expected to catch a violation. |
| **TYPE** | The TypeScript type system rejects the violation. |
| **TEST** | An automated test fails on violation. |
| **DATABASE** | PostgreSQL rejects the violation regardless of the calling code. |

---

## I-1 — Tenant context never comes from the client

`tenantId` is derived from the authenticated server-side session, never from a request
body, query parameter, path segment, cookie or any other client-supplied value.

- **Enforcement: TEST + REVIEW.** No route reads `tenantId` from input (verified by grep
  across `src/app/api` on every audit); `resolvePosContext` and `resolveSession` are the
  only sources of tenant identity.
- **Strengthen by:** a lint rule that fails on `tenantId` appearing in a parsed request
  body schema.

## I-2 — No duplicate authoritative ledger

AMBURAX must never hold an accounting balance, receivable, tax computation or stock
quantity that it treats as authoritative once ERPNext owns that domain.

- **Enforcement: REVIEW.** Today `stock_levels.quantity` and the `sales` money columns do
  exist in PostgreSQL. They are **projections and operational records**, not a ledger: the
  schema documents the signed quantity as drift-visible on purpose, `Sale.erpSyncStatus`
  starts at `PENDING`, and `Sale.billNumber` is explicitly not an invoice number (ADR-063,
  ADR-079).
- **Honest current state:** with no ERPNext connected, AMBURAX is in practice the only
  record of a sale. That is a transitional position, recorded in ADR-085, not a claim that
  the invariant is already satisfied end to end.

## I-3 — Store membership cannot cross a tenant boundary

A `StoreMembership` may only exist when its user and its store belong to the same tenant.

- **Enforcement: DATABASE.** Composite foreign keys `(userId, tenantId) -> users(id, tenantId)`
  and `(storeId, tenantId) -> stores(id, tenantId)`, migration
  `20260913071500_enforce_store_membership_tenant`. Proven by raw SQL that bypasses Prisma
  and by four integration tests.
- This is the reference implementation for I-4.

## I-4 — Tenant-paired references should be database-enforced, in priority order

Several tables carry `tenantId` alongside foreign keys to tenant-owned parents, with no
constraint tying the two together. Application code resolves every parent through the
session's tenant, so none is currently exploitable — but that is I-1's guarantee doing the
work, not the database's.

Priority queue, highest value first (evidence: foreign-key listing of every migration):

| # | Table | Unpaired references | Consequence if application guard fails | Status |
|---|---|---|---|---|
| 1 | `sales` | `storeId`, `cashierUserId`, `customerId` vs `tenantId` | A financial record attributed to the wrong tenant | **Open, P2** |
| 2 | `stock_levels` | `storeId`, `variantId`; `tenantId` has no FK at all | Stock projection attributed to the wrong tenant | **Open, P2** |
| 3 | `sale_items` | `variantId` vs the parent sale's tenant | A line item citing another tenant's product | **Open, P2** |
| 4 | `pos_devices` | `storeId` vs `tenantId` | A till bound to another tenant's store | **Open, P2** |
| 5 | `invitations` | `storeId` vs `tenantId` | An invitation into another tenant's store | **Open, P2** |
| 6 | `product_variants` | `tenantId` has no FK | Orphanable tenant attribution | **Open, P3** |

`store_memberships` was #0 on this list and is closed (I-3). It was first because it is the
only one of the set that grants **authorization** rather than mis-filing data.

**Rule for new tables:** any table with both a `tenantId` and a foreign key to a
tenant-owned parent must use the composite form from the start. Retrofitting is a migration;
getting it right initially is free.

## I-5 — ERPNext is reached only through the adapter

No domain service, API route, background worker, AI tool or commerce connector may call
ERPNext, know a Frappe site id, hold ERP credentials, or depend on an ERPNext document
shape. See [ERP_ADAPTER.md](ERP_ADAPTER.md).

- **Enforcement: CONVENTION (vacuously satisfied).** No ERPNext call exists anywhere in the
  codebase — verified by grep for `fetch`, `axios`, `frappe` and `/api/method` in
  `src/server`. The invariant has therefore never been tested.
- **Strengthen by:** a lint boundary rule once `server/erp/` exists.

## I-6 — Events are produced inside the transaction they describe

An outbox event exists if and only if the business fact it describes committed.

- **Enforcement: TYPE + TEST.** `enqueueOutboxEvent` accepts only a
  `Prisma.TransactionClient`, so it cannot be called with the global client; integration
  tests prove commit-together and rollback-together against real PostgreSQL.

## I-7 — Delivery is never claimed without a transport

An event is marked published only when a configured transport accepted it.

- **Enforcement: TEST.** An unconfigured transport resolves to a publisher that throws, and
  the runner refuses to claim at all, leaving events `PENDING` with `attempts = 0`
  (`20260913`, F-01 remediation).

## I-8 — Authentication is not authorization

A valid session establishes who is calling, never what they may do. Role and scope checks
are re-derived server-side from the database at the point of the operation, including for
AI and API automation.

- **Enforcement: TEST.** `createSale` re-reads cashier and membership and re-evaluates
  `canSell` inside the sale path even though `resolvePosContext` already computed it for
  display; integration tests cover the unauthorised-role and foreign-store cases.

## I-9 — Secrets never reach a log or an event payload

- **Enforcement: TEST.** All error logging routes through `lib/safeLog.ts`; outbox payloads
  are asserted free of pairing codes and secrets by integration test; the dev notifier's
  plaintext echo is hard-gated to non-production.

## I-10 — External identifiers are mapping data, never domain identity

ERP and channel identifiers live in dedicated nullable mapping columns
(`erpnextSiteId`, `erpnextWarehouseId`, `erpInvoiceId`). A domain primary key is always an
AMBURAX cuid.

- **Enforcement: REVIEW + schema shape.** Satisfied today; ADR-007 and ADR-005 already
  stated the rule and the schema follows it.

## I-11 — Capability state is server-side configuration

A capability being off is enforced at the API and domain boundary, never only in
navigation. See [CAPABILITIES.md](CAPABILITIES.md).

- **Enforcement: NONE YET.** No capability storage exists. The current product has one
  capability (Retail) and no gate to bypass. Recorded as the first thing to build when the
  second capability starts — not retrofitted after it ships.
