# Wholesale / B2B — Discovery and Gap Audit

**Status:** discovery only. No code, schema, migration or route was produced by this phase.
**Baseline audited:** `fb7d3b4` (Retail/POS backend and frontend frozen).
**Date:** 2026-09-16.

The single most useful finding is stated up front: **Wholesale needs far less new machinery than
it appears to.** The shared core already carries customers, addresses, GSTIN, price lists with
customer-specific pricing and quantity breaks, a complete order lifecycle with snapshots,
warehouses, an inventory ledger, capability gating, audit and outbox. What is genuinely missing is
narrower and concentrated in three places: **credit, reservation, and fulfilment beyond
bookkeeping.**

---

## 1. Current Backend Capabilities

32 models, 17 enums, 12 migrations. What exists and is relevant:

| Area | Exists | Notes |
|---|---|---|
| Tenant, users, roles, memberships | yes | `TenantRole` OWNER/STAFF; store-scoped memberships |
| Capability model | yes | `Capability` enum **already contains `WHOLESALE`** |
| Customer | yes | name, phone, email, **gstin**, isActive, default billing/shipping pointers, `priceListId` |
| Address | yes | tenant-owned, `AddressType` BILLING/SHIPPING/BOTH, `CustomerAddress` link |
| Product / Variant | yes | SKU, barcode, size, colour, `priceMinor`, `taxRateBp`, base UOM |
| UOM | yes | tenant-scoped, conversions, integer-only contract |
| Pricing | yes | `PriceList` + `PriceListItem` with UOM, **quantity breaks**, validity windows, currency |
| Price resolution | yes | one engine: customer → store → tenant default → variant base |
| Order | yes | full lifecycle, snapshots, idempotency, versioning, per-store numbering, `OrderAddress` |
| Inventory | yes | `StockMovement` ledger (authoritative) + `StockLevel` projection |
| Warehouse | yes | **`Store.storeType = WAREHOUSE`** — warehouses are already modelled |
| Sale / POS | yes | completed retail transaction, POS sessions, payments |
| Audit | yes | 56 distinct actions through one `writeAuditLog` |
| Outbox | yes | transactional envelope, retry, dead-letter |
| ERP adapter | yes | boundary only; no integration |

## 2. Missing Wholesale Capabilities

Nothing below exists in any form today. Each is a genuine gap, not a rename.

| Missing | Severity for Wholesale |
|---|---|
| Credit limit, payment terms, outstanding, ageing | **Blocking** for real B2B trading |
| Reservation accounting (reserved quantity, availability) | **Blocking** for allocation |
| Fulfilment beyond quantity bookkeeping (pick, pack, dispatch) | **Blocking** for delivery |
| Supplier, purchase order, goods receipt | Out of scope — Procurement capability |
| Customer group / hierarchy / classification | High |
| Customer contact persons (multiple named people) | Medium |
| Minimum order quantity | Medium |
| Order-level tax and discount | Medium |
| Inter-store / inter-warehouse transfer | Medium |
| Order-level payment status | Medium |
| Invoice document | Deferred — ERPNext authority |

## 3. Shared Core Reuse

Reusable **as-is**, with no modification:

- **Product, ProductVariant, UOM, UomConversion** — a wholesale SKU is the same SKU.
- **Inventory** — the `StockMovement` ledger and `StockLevel` projection serve both.
- **Warehouse** — `StoreType.WAREHOUSE` already exists; no new location entity is needed.
- **Address / CustomerAddress** — billing and shipping already modelled and tenant-safe.
- **Pricing engine** — `resolvePrice` already resolves customer-specific pricing with quantity
  breaks and UOM awareness. This *is* wholesale pricing; it was simply built during the retail
  phase.
- **Order / OrderItem / OrderAddress** — lifecycle, snapshots, idempotency and concurrency
  controls were built capability-neutral and are deliberately ungated.
- **Capability, audit, outbox, tenant invariants.**

**No new product, variant, inventory, customer, pricing, warehouse or tenant system is required.**

## 4. Required Domain Extensions

Genuinely new concepts, in dependency order:

1. **Customer commercial profile** — credit limit, payment terms, classification, status. An
   extension of `Customer`, not a second customer entity.
2. **Customer contacts** — a B2B buyer has named people; retail has a phone number.
3. **Reservation accounting** — a new ledger-shaped concept (see §9).
4. **Fulfilment documents** — allocation → pick → pack → dispatch (see §10).
5. **Customer group** — for group-level pricing and hierarchy.

Everything else is a field on an existing model or one additional scoping rule in the price chain.

## 5. Customer / B2B Model

| Requirement | Today | Gap |
|---|---|---|
| Business name | `Customer.name` | none |
| GSTIN | `Customer.gstin` | none |
| Billing / shipping addresses | `Address` + pointers + `CustomerAddress` | none |
| Customer-specific pricing | `Customer.priceListId` | none |
| Active status | `Customer.isActive` | none |
| Contact persons | — | **missing** — needs a child entity |
| Classification (retail / wholesale / distributor) | — | **missing** |
| Credit limit | — | **missing** |
| Payment terms | — | **missing** |
| Customer group | — | **missing** |

`Customer` already carries `@@unique([id, tenantId])`, so any child entity can adopt the frozen
composite-FK pattern immediately.

**One caution:** `@@unique([tenantId, phone])` makes phone the retail identity key. A B2B customer
may have no phone, or two legal entities may share a switchboard number. NULLs are distinct in a
PostgreSQL unique index so multiple null-phone customers are already fine, but a shared landline
across two entities would collide. This needs a decision before B2B onboarding.

## 6. Pricing Model

**Already sufficient for most wholesale pricing.** `PriceListItem` carries `(priceList, variant,
uom, minQuantity)` with validity windows and currency, and `resolvePrice` walks customer → store →
tenant default → variant base, falling through on *no applicable item*.

| Requirement | Today | Gap |
|---|---|---|
| Customer-specific price | yes — `Customer.priceListId` | none |
| Quantity breaks | yes — `minQuantity` | none |
| UOM-based pricing | yes — required `uomId` | none |
| Effective dates | yes — `validFrom` / `validTo` | none |
| Priority | yes — implicit in the chain | none |
| Price snapshot on order | yes — locked at confirmation | none |
| Customer-group price | — | **missing** — one new chain step |
| Minimum order quantity | — | **missing** — a constraint, not a price |
| Discount structures | — | **deliberately absent**; see §11 |

**Do not build a second pricing engine.** A customer-group price is one additional candidate in
the existing chain, between customer and store.

## 7. Order Model

**Recommendation: extend the existing `Order`. Do not create a `WholesaleOrder`.**

The current lifecycle is `DRAFT → CONFIRMED → PARTIALLY_FULFILLED → FULFILLED → CLOSED`, with
`CANCELLED` off to one side — exactly the lifecycle this brief proposes. It was built
capability-neutral deliberately and is **not** gated behind RETAIL.

Already serving wholesale: per-store numbering, idempotency, optimistic `version`, price and
catalogue snapshots, address snapshot at confirmation, `fulfilledQuantity` per line, an
exhaustively tested transition matrix, and cancellation with a required reason.

Extensions likely required:

| Extension | Why |
|---|---|
| Order source / channel | A wholesale order and a counter order need distinguishing. Deferred in P1-8G because only one origin existed; a second origin now justifies it. |
| Expected delivery date | B2B orders are promised, not immediate. |
| Customer reference / PO number | The buyer's own paperwork reference. |
| Payment status axis | Separate from fulfilment; absent entirely today. |
| Order-level tax and discount | Deliberately excluded in P1-8G; wholesale invoicing needs them. |
| `RESERVED` becoming reachable | Only once §9 is satisfied in full. |

**`Order.storeId` is required today.** A wholesale order dispatched from a warehouse works because
warehouses are Stores — but this should be confirmed, not assumed, when multi-warehouse allocation
arrives.

## 8. Credit Model

Nothing exists. No credit limit, terms, outstanding, ageing or credit check appears anywhere in
the schema. **This is the largest genuine gap.**

Proposed authority split:

| Concern | Authority |
|---|---|
| Credit limit (the policy) | **AMBURAX** — an operational trading rule |
| Payment terms (NET 30 etc.) | **AMBURAX** — attaches to the customer |
| Credit check at order confirmation | **AMBURAX** — a workflow gate |
| Outstanding balance | **ERPNext** — derived from invoices and receipts |
| Ageing buckets | **ERPNext** |
| Receivables, GL, payments | **ERPNext** |

The difficulty: a credit *check* needs the outstanding balance, which ERPNext owns, and no ERP
integration exists. Until it does, any "available credit" figure AMBURAX computes would be
invented. **Do not implement credit accounting in the first Wholesale phase.** The honest interim
is to store limit and terms as configuration and defer enforcement.

## 9. Reservation

**State today: nothing.** Verified directly against the database:

- `StockMovementType` = `OPENING_BALANCE, RECEIPT, SALE, ADJUSTMENT, STOCK_TAKE`. No reservation.
- `column_name ILIKE '%reserv%'` across the entire schema returns **zero rows**.
- `OrderStatus.RESERVED` exists with an empty outbound transition list and is refused by
  `transitionOrder` with a distinct `reservation_unavailable` result.

Required before `RESERVED` may be activated — all of it, not part:

1. **Reserved quantity** as a first-class figure per (store, variant).
2. **Availability redefined:** `available = onHand − reserved`. Every existing read of
   `StockLevel.quantity` must be audited, because today it means on-hand and would silently
   become wrong.
3. **A reservation entity** — which order, which line, which quantity, which location.
4. **Expiry** — a held reservation never fulfilled must release, or stock leaks.
5. **Release / cancellation** — on order cancellation, line edit, or expiry.
6. **Fulfilment consumption** — a reservation converts to a movement and never double-counts.
7. **Concurrency** — two orders reserving the last unit must serialise, using the same
   `ON CONFLICT` discipline the ledger already uses.
8. **Audit and outbox** events for reserve, release, expire.
9. **Tenant isolation** — composite FKs like every other tenant-owned table.
10. **Reconciliation** — a sweep proving reserved quantities match live reservations.

**Recommendation: keep `RESERVED` unreachable in the first Wholesale phase.** A reservation that
expires silently, or double-counts under concurrency, is worse than none: it promises a customer
stock the warehouse cannot produce. This deserves its own phase.

## 10. Fulfilment

Today's fulfilment is **quantity bookkeeping only**: `OrderItem.fulfilledQuantity` increments and
the order status is *derived* from it. It writes no stock movement, creates no shipment, and knows
nothing about picking or dispatch. Correct for P1-8G; insufficient for wholesale.

| Step | Today | Required |
|---|---|---|
| Allocation | — | which stock, which warehouse |
| Pick | — | a picking instruction |
| Pack | — | cartons, weights |
| Dispatch | — | vehicle, driver, e-way bill |
| Delivery confirmation | — | proof of delivery |
| Stock consequence | **none** | fulfilment must move stock |

**The critical unresolved question:** when does wholesale stock actually leave — at dispatch, or at
invoice? Retail collapses the two: a Sale moves stock immediately. Wholesale separates them, and
the answer decides whether fulfilment writes a `StockMovement` or whether a separate document
does.

Do not create Pick / Pack / Shipment models until that question is answered.

## 11. ERP Boundary

| AMBURAX authority | ERPNext authority |
|---|---|
| B2B customer relationship state | Accounting, GL |
| Credit limit and terms (policy) | Outstanding balance, ageing, receivables |
| Pricing configuration | Tax computation and filing |
| Order workflow and lifecycle | Invoices |
| Fulfilment workflow | Payments and settlement |
| Operational stock projection | ERP stock ledger where applicable |

The adapter remains a boundary only: **0** imports of `server/erp/` outside the adapter, **0**
Frappe strings elsewhere, **0** ERP dependencies, **0** network calls. Wholesale must not change
this, and no wholesale service may import the adapter.

## 12. Capability Model

**`Capability.WHOLESALE` already exists in the enum.** No migration is needed to name it.

Required:

1. **Gating** — wholesale-specific operations call `requireCapability(tenantId, WHOLESALE)` at the
   domain boundary, matching the three existing RETAIL gates
   (`saleService`, `posSessionService`, `posDeviceQueries`).
2. **Default grant** — WHOLESALE must **not** join `DEFAULT_CAPABILITIES` (currently `[RETAIL]`).
   It is switched on deliberately, by an owner, when the business actually sells wholesale.
3. **Disabled behaviour** — a disabled capability answers as not-found at the HTTP boundary, per
   the P1-7 freeze.
4. **Mutation** — remains OWNER-only; unchanged.
5. **Shared foundations stay ungated** — Product, Variant, UOM, Customer, Address, Pricing,
   Inventory and **Order** must remain usable without WHOLESALE. Order is explicitly ungated today
   and must stay so.

The dependency rule "Distribution requires Wholesale" is documented in
`ARCHITECTURE_INVARIANTS.md` but not enforced. Enforcing it becomes reasonable once a second
capability has a real implementation.

## 13. Concurrency Requirements

Invariants that must hold. The first three already do:

| Operation | Required invariant | State |
|---|---|---|
| Order confirmation | One winner under simultaneous confirm | **safe** — optimistic `version` |
| Order numbering | No duplicate numbers | **safe** — store row lock |
| Idempotent creation | One order per key | **safe** — unique index |
| Credit check | Two orders against one limit must not both pass | **not built** |
| Inventory allocation | Two orders must not both take the last unit | **not built** |
| Reservation | Reserve/release serialised per (store, variant) | **not built** |
| Fulfilment | Concurrent partial recordings must not lose one | **known P3 today** |
| Customer price resolution | Read-only | safe |
| Payment / collection | Not yet designed | — |

Established patterns cover most of these: `ON CONFLICT DO UPDATE` for counters,
`pg_advisory_xact_lock` for serialising a key, optimistic `version` for documents.

## 14. Tenant Isolation

Every new table must follow the frozen invariant without exception:

- `tenantId` on any tenant-owned row.
- Composite FKs `(childId, tenantId) → parent(id, tenantId)`.
- `@@unique([id, tenantId])` on any new parent.
- Raw-Prisma cross-tenant rejection tests expecting `P2003`.
- Server-derived `tenantId`, never from a request.

The standing sweep in `tenantInvariants.test.ts` asserts no single-column FK exists between two
tenant-scoped tables, so a forgotten composite key fails automatically. Current state: **68 FKs,
47 composite, 0 unpaired**, identical across fresh, dev and test.

## 15. Proposed Implementation Phases

Small, auditable, each independently committable:

| Phase | Scope | Depends on |
|---|---|---|
| **W-1** | Customer commercial profile: classification, contacts, payment terms, credit limit **as configuration only**. WHOLESALE capability gate wired. | — |
| **W-2** | Customer groups + group pricing as one new step in the existing chain. | W-1 |
| **W-3** | Order extensions: source/channel, customer PO reference, expected delivery date, minimum order quantity. | W-1 |
| **W-4** | Order-level tax and discount. Closes a deliberate P1-8G gap. | W-3 |
| **W-5** | **Reservation foundation** — the full §9 list, or nothing. `RESERVED` becomes reachable here and only here. | W-3 |
| **W-6** | Allocation and fulfilment documents, after the dispatch-vs-invoice question is answered. | W-5 |
| **W-7** | Credit enforcement — requires ERP outstanding balance, therefore requires ERP integration. | W-1, ERP phase |

W-1 through W-4 are buildable now. W-5 onward have genuine prerequisites.

## 16. Risks

**Genuine:**

1. **Reservation is the hard part and looks easy.** Activating `RESERVED` without the full
   accounting model would promise customers stock the warehouse cannot honour. The existing
   refusal is a feature, not an omission.
2. **`StockLevel.quantity` currently means on-hand.** Introducing reserved stock changes what
   "available" means everywhere it is read — POS scan, catalogue, order entry. A silent breaking
   change unless every reader is audited.
3. **Credit cannot be enforced without ERP.** Outstanding balance is ERPNext's; any interim
   "available credit" AMBURAX computes is fiction.
4. **Dispatch-vs-invoice stock timing is undecided**, and it determines the whole fulfilment
   model.
5. **`@@unique([tenantId, phone])` on Customer** may collide for B2B entities sharing a number.
6. **Inherited, unchanged:** non-transactional `AuditLog` (P2); idempotency-key payload conflicts
   are not detected (P2); order fulfilment can lose one of two concurrent partial recordings (P3).

**Not risks, despite appearances:** pricing (already sufficient), warehouses (already modelled),
order lifecycle (already correct), tenant isolation (already enforced).

## 17. Files Changed

This document only: `docs/WHOLESALE_B2B_DISCOVERY.md`.

No application code, schema, migration, route, test or frontend file was created or modified.

## 18. Scope Boundary

Not implemented and not started: wholesale services, B2B endpoints, credit, reservation,
allocation, fulfilment, picking, packing, dispatch, supplier, purchase orders, ERP integration,
customer groups, order-level tax and discount, and any schema or migration whatsoever.
