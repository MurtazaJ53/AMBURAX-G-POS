# AMBURAX — P1-7 Architecture Freeze Record

Recorded 2026-09-13 against commit `c244f00` on `main`.

## What is being frozen, and what is not

This is a **decision freeze**, not a proof of production readiness. Those are different
claims and conflating them is how architecture documents start lying.

**Frozen** — these are settled, and changing one now requires a new ADR that supersedes the
old one rather than a quiet edit:

- the three-plane split and the tenant router's position
- the tenant / ERPNext-site / ERPNext-company / store / warehouse concept mapping
- capability-as-configuration over one shared domain core
- data ownership between AMBURAX and ERPNext, and the no-dual-authority rule
- the ERPNext adapter as the single boundary component
- cell-based scaling and stable tenant identity across migrations
- the durable-outbox event model, its envelope, and at-least-once delivery
- the authorization order and the authentication ≠ authorization rule
- the AI permission boundary
- the commerce channel-adapter abstraction
- the invariants in [ARCHITECTURE_INVARIANTS.md](ARCHITECTURE_INVARIANTS.md)

**Not frozen, and deliberately not claimed:**

- any capacity number — tenants per cell, sites per pool, transactions per second (see
  [CELL_ARCHITECTURE.md](CELL_ARCHITECTURE.md) capacity variables)
- RPO and RTO targets — no backup exists to measure a restore against
- whether a POS sale waits for ERPNext synchronously (ADR-078, still open)
- per-tenant coordinated backup/restore ordering across PostgreSQL and MariaDB (open)
- multi-region posture

**The two objections in the older `ARCHITECTURE_FREEZE.md` still stand and are not waved
away:** there is no CI enforcing these gates mechanically, and the ERPNext principles remain
unexercised because no ERPNext is connected. They block a *proven-architecture* freeze. They
do not block a *decision* freeze, which is what P1-7 was scoped to produce, and they are
carried forward as named checkpoints rather than quietly dropped.

## Revisit checkpoints

| Checkpoint | Re-examine |
|---|---|
| First ERP adapter in place | Invariant I-5, ADR-078, data ownership in practice |
| CI running the backend gates | Enforcement level of every invariant marked TEST |
| Second capability (Wholesale) starts | Capability gating (I-11) must exist before, not after |
| First real event consumer | Ordering assumptions, broker choice, dead-letter operations |
| First tenant beyond the shared tier | Cell sizing, placement metadata, tier promotion |

## Contradiction audit

Searched the repository for the failure modes that matter: client-supplied tenant identity,
ERPNext calls outside an adapter, duplicate domain cores, capability bypass, event types
claimed as implemented, raw SQL bypassing domain ownership, unscoped tenant data, unsafe
cross-tenant relations, ERP ids as domain identity, and AI bypass paths.

| # | Finding | Severity | Blocks freeze | Action taken |
|---|---|---|---|---|
| C-1 | `DATA_OWNERSHIP_MATRIX.md` described Sale, Product, Customer and stock as NOT IMPLEMENTED, and asserted "no stock quantity column exists". The retail slice (`bbc0948`) shipped all of them. | **P1** | Yes | **Fixed** — matrix corrected in this pass |
| C-2 | No capability storage or gate exists; `BusinessType` is a single-choice enum, not a capability set | P2 | No | Specified in CAPABILITIES.md; I-11 records that the gate must precede capability #2 |
| C-3 | `PERMISSIONS.md` specifies `resource.action` permissions and named roles; the implementation is three hardcoded role allowlists and a free-string `StoreMembership.role` | P2 | No | Target model frozen; implemented subset recorded in PERMISSIONS.md |
| C-4 | Six tables carry `tenantId` with no foreign key at all: `audit_logs`, `mfa_challenges`, `password_reset_tokens`, `product_variants`, `sessions`, `stock_levels` | P2/P3 | No | Queued in I-4 with priority order |
| C-5 | Five tables reference tenant-owned parents without composite tenant pairing (`sales`, `stock_levels`, `sale_items`, `pos_devices`, `invitations`) | P2 | No | Queued in I-4. Not exploitable today: every write path resolves parents through the session tenant, and the one case that granted *authorization* rather than filing data (`store_memberships`) was closed in `20260913071500` |
| C-6 | `EVENTS.md` lists ~45 event names with no status marking; 6 exist in code, 2 have producers | P2 | No | **Fixed** — statuses, producers and idempotency keys recorded in EVENTS.md |
| C-7 | ERPNext ownership rules are unexercised — no adapter, no ERPNext, every `erpnext*` column null | Informational | No | Already disclosed; restated here and in I-5 |
| C-8 | With no ERP connected, AMBURAX is in practice the only record of a sale and of stock | **P1 (disclosure)** | No — because it is disclosed, not hidden | Recorded in I-2 and ADR-085; `erpSyncStatus = PENDING` and `billNumber ≠ invoice number` already encode it in the schema |
| C-9 | `sale_items` and `sale_payments` have no `tenantId`; they inherit tenancy through their parent sale | P3 | No | Acceptable and now stated as a rule: never query a child without joining its parent |
| C-10 | Two package-manager lockfiles tracked | P2 | No | Carried from the P1 audit; not an architecture matter |
| C-11 | No CI | P2 | No | Carried forward as a named checkpoint |

**No P0 findings.** The single P1 that blocked the freeze (C-1) was a documentation
contradiction — the map disagreeing with the territory — and was fixed by correcting the
map. C-8 is P1 in severity but is a disclosure obligation, already satisfied in code
comments and now in the ownership matrix.

## Verification at freeze time

| Gate | Result |
|---|---|
| Lint | PASS |
| Typecheck | PASS |
| Unit tests | PASS — 25 files, 292 tests |
| Integration tests (real PostgreSQL 16.15) | PASS — 5 files, 109 tests |
| Build | PASS |
| Prisma migration status | PASS — 4 migrations, up to date |
| Schema drift | PASS — no difference detected |
| Frontend untouched | PASS — no `.tsx`, `(app)`, Tailwind or asset path in the P1-7 diff |

## Next implementation phase

The dependency analysis, not the wish list. Wholesale is the intended next capability, and
it cannot be built honestly on today's foundations without first adding the shared pieces it
needs — otherwise it will grow its own customer, order and inventory concepts, which is
precisely what [CAPABILITIES.md](CAPABILITIES.md) forbids.

**Recommended order:**

1. **Foundational domain hardening** — the shared-core gaps: `Order` with a lifecycle (a
   `Sale` is an immediate transaction, not an order), UOM, addresses as entities, price
   lists, and the I-4 composite-key queue for `sales` and `stock_levels`.
2. **ERP adapter skeleton against a real ERPNext** — this is what converts four vacuous
   principles into tested ones, and it gates every financial claim the product wants to make.
3. **Wholesale / B2B** — needs 1 and benefits from 2 (credit checks and receivables are
   ERP-mastered).
4. **Procurement and inventory expansion** — supplier, GRN, batch/lot.
5. **Manufacturing**, then **Job Work** — both need batch/lot, WIP and material ownership
   discrimination from step 4.
6. **Commerce** — needs a stable catalogue, allocation policy and the mapping layer.
7. **Distribution**, then **AI**, then **enterprise scaling** (cells, tiers, regions).

CI belongs before or alongside step 1, not at the end: every gate in this freeze is
currently run by hand.
