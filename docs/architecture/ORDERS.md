# Orders

**Phase:** P1-8G · **Status:** implemented · **Migration:** `20260915090000_add_order_foundation`

An order is demand, recorded before anything has been fulfilled. It is a new, additive document.
**It does not replace `Sale`, and creating one does not create a sale.**

## Order is not Sale

| | Sale | Order |
|---|---|---|
| What it is | a completed retail transaction | a commitment that something will happen |
| When | one instant, at a till | may live for days between agreement and completion |
| Stock | moves stock (`StockMovement`) | **moves nothing** |
| Money | takes payment, computes tax and discount | records agreed line prices; no payment, no tax, no discount |
| Number | `SA-000001` from `Store.nextBillSeq` | `SA-SO-000001` from `Store.nextOrderSeq` |
| Mutable | no | only while DRAFT |

`saleService`, `saleTotals`, `Sale` and `SaleItem` are untouched by this phase. The POS still
writes a Sale directly and never passes through an order.

The two counters are deliberately separate. Sharing one sequence would make order `SO-000042` and
bill `SA-000042` unrelated strangers that look like a matched pair.

## Schema

```
Order
  id, tenantId
  storeId            required  -> composite FK (storeId, tenantId)
  orderNumber        "SA-SO-000001", unique per store
  customerId         nullable  -> composite FK (customerId, tenantId)
  status             OrderStatus, default DRAFT
  currency           copied from the store at creation
  subtotalMinor      integer minor units, server-computed
  version            optimistic concurrency counter
  idempotencyKey     unique per tenant
  createdByUserId
  confirmedAt, cancelledAt, cancellationReason, closedAt   all nullable
  createdAt, updatedAt

  unique (tenantId, idempotencyKey), (storeId, orderNumber), (id, tenantId)

OrderItem
  id, tenantId, orderId  -> composite FK (orderId, tenantId), ON DELETE CASCADE
  variantId              -> composite FK (variantId, tenantId)
  uomId       required   -> composite FK (uomId, tenantId)
  quantity, fulfilledQuantity          integers
  unitPriceMinor, lineTotalMinor       integer minor units
  priceSourceSnapshot, priceListIdSnapshot
  skuSnapshot, nameSnapshot, uomCodeSnapshot
  createdAt, updatedAt

  unique (orderId, variantId, uomId)

OrderAddress
  id, tenantId, orderId  -> composite FK (orderId, tenantId), ON DELETE CASCADE
  type                   BILLING | SHIPPING
  line1, line2, city, state, postalCode, country
  contactName, contactPhone
  sourceAddressId        nullable, provenance only -> composite FK (sourceAddressId, tenantId)
  createdAt

  unique (orderId, type)
```

### Field decisions

**`storeId` is required.** Pricing resolves against a store (P1-8E reads its currency and price
list), and the order number comes from that store's counter. An order belonging to no location
cannot answer "at what price, in what currency".

**`customerId` is nullable.** A walk-in who orders something to collect later is a real order with
no customer record. Present or absent, never another tenant's.

**`currency` is copied, not referenced.** An order priced in one currency must not start reading
differently because the store was later reconfigured. Nothing converts anything.

**`uomId` is required on a line.** A quantity without a unit is meaningless once units exist — ten
of something is not an amount. Same rule P1-8E applies to a price.

**There is no `totalMinor`.** Tax and discount are out of scope for this phase, so a total would be
identical to the subtotal, and a field that means nothing yet is a field code starts trusting. When
tax and discount arrive, a total arrives with them.

**There is no source/channel discriminator.** There is exactly one way to create an order today, so
a column with one real value would be a guess about phases that have not been designed. Wholesale
and commerce origins add it when they exist and mean something.

**There is no payment field of any kind.** Payment is a separate axis and remains entirely outside
this phase. No status, no amount, no table — nothing that could be mistaken for a payment record.

**Lines are written as their own statement, not as a nested create.** The composite relation
`(orderId, tenantId)` means Prisma treats `tenantId` as owned by the relation and refuses it as a
field in a nested create. That is the price of proving tenant ownership in the database rather than
trusting the code that writes it, and it is worth paying.

## Status machine

```
DRAFT ─────────────► CONFIRMED ──┬──► PARTIALLY_FULFILLED ──► FULFILLED ──► CLOSED
  │                     │        │            ▲    │
  │                     │        └────────────┼────┘
  ▼                     ▼                     └────┘  (further partial deliveries)
CANCELLED ◄─────────────┘

RESERVED — present in the enum, unreachable. See below.
```

| From | May become |
|---|---|
| `DRAFT` | `CONFIRMED`, `CANCELLED` |
| `CONFIRMED` | `PARTIALLY_FULFILLED`, `FULFILLED`, `CANCELLED` |
| `RESERVED` | *(nothing — unreachable)* |
| `PARTIALLY_FULFILLED` | `PARTIALLY_FULFILLED`, `FULFILLED` |
| `FULFILLED` | `CLOSED` |
| `CLOSED` | *(terminal)* |
| `CANCELLED` | *(terminal)* |

All 49 ordered pairs are asserted exhaustively in `test/orderStatus.test.ts`, so adding a status
without deciding what may reach it fails there rather than in production.

**There is no "set the status to what I sent" path.** Every transition has real work behind it —
re-resolving prices, snapshotting addresses, recording a cancellation reason, counting delivered
quantities — or it is refused. A status column any caller can assign is not a state machine.

**Cancellation stops at CONFIRMED.** Cancelling a partially fulfilled order would mean cancelling
the remainder, which changes outstanding quantities rather than the document's fate, and doing it
properly needs a per-line cancelled quantity this phase does not carry. A cancellation reason is
required — an unexplained cancellation is indistinguishable from a mistake, the same reasoning
`StockMovement.reason` uses.

**Only a DRAFT is editable**, and only its lines and customer. Order number, store, currency,
status and version are not editable by any caller at any point.

## RESERVED: what it actually means

**RESERVED is a lifecycle state that cannot be reached. It is not, and does not claim to be, an
inventory reservation.**

The enum carries it because the approved lifecycle names it. No transition leads to it,
`transitionOrder` refuses it with its own distinct `reservation_unavailable` result, and an
integration test asserts that no order anywhere is ever in it.

The reason is simple and checkable: **nothing in this system accounts for reserved stock.**

- `StockMovementType` has no `RESERVATION` member — asserted by a test that reads `pg_enum`.
- `StockLevel` is a plain projection of the movement ledger's running sum.
- No column anywhere records committed-but-unshipped quantity.

An order whose status read RESERVED would therefore assert that stock is set aside when nothing has
set anything aside, and the next person to trust it would be a picker finding an empty shelf. The
honest options were to build reservation accounting — a ledger change, large and explicitly out of
scope — or to leave the state unreachable and say so. This is the second.

When a reservation foundation exists, `CONFIRMED → RESERVED → fulfilment` becomes reachable by
adding edges to `ORDER_TRANSITIONS`. Nothing else has to change.

## Fulfilment is quantity accounting, not a fulfilment engine

`recordFulfilment` increments `OrderItem.fulfilledQuantity` and derives the order's status from the
result. That is all it does.

It writes **no stock movement**, creates **no shipment**, and knows nothing about picking, packing,
couriers, AWBs or tracking. It exists for one reason: `PARTIALLY_FULFILLED` and `FULFILLED` must be
derived from recorded fact rather than set by a client sending a status string — the same principle
that makes RESERVED unreachable. Asking the transition endpoint for either status directly is
refused and points the caller at the quantities.

Over-delivery is refused rather than clamped. Delivering more than was ordered is a real event in a
warehouse, but the order says what was agreed, and quietly raising it would erase a disagreement
someone needs to see.

The real fulfilment phase will add shipments, stock consequences and everything else. This is the
minimum that makes the status truthful.

## Inventory is untouched

Creating, confirming, fulfilling or cancelling an order writes **no `StockMovement`** and changes
**no `StockLevel`**. Asserted by tests that snapshot both before and after.

`StockMovement` remains the ledger and `StockLevel` remains its projection. The only thing that
decrements stock is still a Sale.

## Pricing

Every price comes from the P1-8E pricing service. **The pricing algorithm was not modified and not
duplicated.**

`OrderLineInput` is `{ variantId, uomId, quantity }` — there is no price field, so a client cannot
override what it cannot express. A test smuggles `unitPriceMinor: 1` in through a cast anyway and
asserts the line still costs what the server resolved.

| Lifecycle point | Pricing |
|---|---|
| `DRAFT` | **provisional** — whatever the pricing service said when the line was added |
| `CONFIRMED` | **locked** — every line re-resolved at the moment of commitment and written down |

A draft may sit for days; what the business commits to is the price at the moment of commitment,
not what was quoted when someone first added the line. After confirmation the stored price is the
agreement, and later edits to any price list cannot reach it.

The full P1-8E chain applies unchanged: customer list → store list → tenant default → variant base,
with quantity breaks and currency refusal. Orders inherit all of it by calling `resolvePrice`.

## Historical snapshots

An order is a record of what was agreed, and what was agreed cannot be reconstructed from today's
catalogue. These are copied, not referenced:

| Snapshot | Survives |
|---|---|
| `unitPriceMinor`, `lineTotalMinor` | the price list being edited or deleted |
| `priceSourceSnapshot`, `priceListIdSnapshot` | the list changing shape — kept for explaining a price, never for recomputing one |
| `skuSnapshot`, `nameSnapshot` | the product being renamed or re-SKU'd |
| `uomCodeSnapshot` | the unit being renamed or retired |
| `OrderAddress` rows | the customer editing or deactivating the address |

Each is asserted by a test that changes the underlying record afterwards and re-reads the order.

`SaleItem` established this discipline with `skuSnapshot`/`nameSnapshot`; an order needs it more,
because it lives far longer between agreement and completion.

## Address snapshot

`docs/architecture/ADDRESS.md` wrote this rule down at P1-8D, before there was an order to apply it
to: "editing a customer's address afterwards must never rewrite where something was already
shipped". This phase implements it.

At **confirmation**, the customer's default billing and shipping addresses are copied in full into
`OrderAddress` rows. A draft has no snapshot — nothing has been committed to yet. A walk-in order
with no customer gets no snapshot rather than an invented one.

`sourceAddressId` is provenance only. Nothing reads through it to render the order, and the
snapshot stands alone when the source is deactivated — asserted by test.

## Money

Integer minor units throughout. No floats, no decimals, no conversion, no FX. `subtotalMinor` is the
sum of the line totals and nothing else; tax and discount are **deliberately excluded** from an
order in this phase. An `information_schema` test asserts every quantity and money column is still
`integer`.

Order arithmetic lives in `orderTotals.ts`, deliberately **not** reusing `saleTotals.ts`: that
calculation extracts tax from an inclusive price and applies discounts, which would mean pushing
zeros through machinery built for a different question and inviting someone to "just add" a rate
later in the wrong place.

## Quantities

Integer, in the unit named on the line. The P1-8C contract holds: no decimals, no fractional metres,
no fractional kilograms. The unit is validated against the variant by the pricing service, which
already knows the base-unit rule and refuses a unit it cannot price.

## Tenant isolation

`tenantId` always comes from the resolved session. No endpoint has a tenant parameter.

Composite foreign keys mean PostgreSQL rejects a cross-tenant pairing whatever the calling code
believes — an order pointing at another tenant's store or customer, a line pointing at another
tenant's variant or unit, a line attached to another tenant's order, an address snapshot sourced
from another tenant's address. All are proven by tests that bypass the service entirely and expect
`P2003`.

Another tenant's order answers **exactly** like one that does not exist; a test asserts the two
responses are deeply equal, so the API cannot be used to discover whether an order belongs to
someone else.

## Idempotency and concurrency

**Creation** is idempotent on `(tenantId, idempotencyKey)`, the same contract `Sale` uses. The
fast-path read makes a retry cheap; the unique index is the actual guarantee; a lost race is
resolved by returning the winner's order rather than failing the retry. Three concurrent creates
with one key produce exactly one order.

**Order numbers** are allocated by incrementing `Store.nextOrderSeq` as the first statement of the
creating transaction, which takes the Store row lock for its life — the identical discipline
`billNumber` uses. Four concurrent creates produce four distinct numbers.

**Transitions** use an optimistic `version`. Every transition updates conditionally on the version
and status it read; zero rows matched means somebody else moved the order first, and the attempt is
reported as a conflict rather than overwriting their work. Two simultaneous confirmations leave
exactly one winner and `version + 1`.

No exactly-once claim is made anywhere.

## Authorization and capability

**Authorization** reuses `canSell` — OWNER, STORE_MANAGER, SALES_ASSOCIATE, CASHIER. Committing the
business to supplying goods is a selling act, and the people who may ring up a sale are the people
who may take an order. No new role, no RBAC layer.

**No capability gate.** An order is a shared foundation that wholesale, commerce and retail
workflows will all sit on; gating it behind RETAIL would make it unavailable to the capabilities it
exists to serve, and gating it behind WHOLESALE would be worse. A test disables every capability and
confirms an order can still be taken. Capability gating belongs on the capability-specific workflows
built later.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/orders` | list the tenant's orders, optional `?status=` |
| `POST` | `/api/v1/orders` | create a DRAFT (201, or 200 on replay) |
| `GET` | `/api/v1/orders/{id}` | read one |
| `PUT` | `/api/v1/orders/{id}` | replace a DRAFT's lines |
| `POST` | `/api/v1/orders/{id}/transition` | confirm, cancel, close |
| `POST` | `/api/v1/orders/{id}/fulfilment` | record fulfilled quantities |

No fulfilment, wholesale, marketplace, shipment or payment API was created.

Error semantics: `not_found` 404 (including every foreign-tenant resource), `forbidden` 403,
`validation_error` 400, `conflict` 409, `invalid_transition` 409, `no_price` 409,
`currency_mismatch` 409, and `reservation_unavailable` 409 with an explanation rather than a
generic refusal.

## Audit

Order events ride the **existing** `AuditLog`: `OrderCreated`, `OrderDraftUpdated`,
`OrderConfirmed`, `OrderCancelled`, `OrderFulfilmentRecorded`, `OrderClosed`, each with the actor,
the correlation id and the order id.

**Audit writes are not transactional.** `writeAuditLog` uses the global Prisma client, so the audit
row is written outside the mutation's transaction; if the process dies between them, the record and
the fact disagree. This is the documented, pre-existing `AuditLog` trade-off (see the schema comment
above `OutboxEvent`), inherited unchanged — P1-8G did not redesign it. Order events are also **not**
emitted as outbox events; nothing consumes them yet.

## What this phase deliberately did not build

Wholesale, B2B workflows, quotations, credit checks, reservation accounting, a fulfilment engine,
picking, packing, shipping, couriers, marketplaces, procurement, manufacturing, job work, the
ERPNext adapter, accounting, a tax engine, promotions, coupons, schemes, loyalty, a payment engine,
RBAC, teams, approval limits, offline POS, AI, Kafka, and decimal quantities.

The order model is shaped so wholesale, commerce and channel orders are the same document with
different origins — not so that each gets its own order system.
