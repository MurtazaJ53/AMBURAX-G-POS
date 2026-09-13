# AMBURAX — Unit of Measure

Established by P1-8C, 2026-09-14. Migration `20260914090000_add_uom_foundation`.

## What this is, and what it is not

A garment business needs to say "a carton holds 24 pieces" and have the system agree. That is
what this adds: a tenant-scoped catalogue of units, exact integer conversions between them, and
a base unit per product.

It is **not** a measurement system. No dimensions, no SI base units, no unit algebra. And it is
**not** the decimal-quantity migration — see below, because that boundary is the whole point.

## Quantity contract — unchanged

| | |
|---|---|
| `SaleItem.quantity` | `Int` — unchanged |
| `StockLevel.quantity` | `Int` — unchanged |
| `StockMovement.quantityDelta` | `Int` — unchanged |
| Fractional metres / kilograms | **not implemented** |
| Rounding | **never** — an inexact conversion is refused |

An integration test asserts these three columns are still `integer` in the live schema, so the
boundary is enforced by a failing test rather than by review.

**Why decimals are deferred:** changing a quantity column to `Decimal` changes the contract of
every function that touches it — `validateQuantity`, `validateMovementQuantity`, the totals
arithmetic, the projection sum — and leaves half a system rounding while the other half does
not. It deserves its own phase, its own migration and its own tests. Packaging units (PACK,
DOZEN, CARTON) are integers throughout and cover the garment wholesale case without it.

`Uom.decimalPlaces` exists so the catalogue can honestly describe METRE or KG, and is
deliberately inert: `convertQuantity` refuses to compute with such a unit, and a product cannot
be based on one. A unit that declares decimals is a note about the future, not a capability.

## The models

**`Uom`** — `{tenantId, code, name, decimalPlaces, isActive}`, unique per `(tenantId, code)`.
Tenant-scoped because two businesses may both use "BOX" and mean different quantities.

**`UomConversion`** — `{tenantId, fromUomId, toUomId, factor}`, unique per
`(tenantId, fromUomId, toUomId)`. One row means **"one `fromUom` contains `factor` of
`toUom`"**. Stored in one direction only, larger to smaller, `factor >= 2`.

**`Product.baseUomId`** — nullable, composite FK `(baseUomId, tenantId) -> uoms(id, tenantId)`.
Every stored quantity for that product is in this unit. Packaging units exist only at the edges
of the system, where a person types one.

All three carry composite foreign keys, so PostgreSQL rejects a cross-tenant pairing regardless
of what the calling code believes (invariant I-4).

## Conversion contract

```
1 DOZEN  = 12 PCS
1 CARTON = 24 PCS
1 PACK   =  6 PCS
```

Four paths exist, and nothing else:

| Direction | Arithmetic | Example |
|---|---|---|
| Identity | unchanged | 5 PCS -> 5 PCS |
| Down a defined edge | `quantity x factor` | 2 DOZEN -> 24 PCS |
| Up a defined edge | `quantity / factor`, exact only | 24 PCS -> 2 DOZEN |
| Across a shared unit | down, then up | 4 CARTON -> 8 DOZEN |

**The rule for inexact conversions: reject.** `13 PCS -> DOZEN` is refused with `not_exact` and
a remainder of 1 PCS. It does not become 1.

Rounding up would create stock that does not exist; flooring would destroy stock that does.
Since every quantity here is an integer, "one and a bit dozen" has nowhere to live. A caller who
wants leniency should not convert — they should keep the number in base units, which is what
every stored quantity already is.

Only one direction is ever stored. Defining `DOZEN -> PCS` and then `PCS -> DOZEN` is refused as
a conflict, because the reverse is derived by division and two stored rows could disagree.

## Default PCS and the backfill

The migration creates exactly one PCS per existing tenant, with the deterministic id
`uom_pcs_<tenantId>`, and points every existing product at its own tenant's PCS. Re-running it
cannot create a second — the primary key collides, and `(tenantId, code)` says the same thing
from the other side.

This is a record, not a guess: every product in this system has always been counted in pieces
(integer quantities, a POS that sells garments one at a time). The migration verifies its own
work before committing — it raises and rolls back if any product whose tenant has PCS is left
without a base unit, or if any product ends up pointing at another tenant's unit. On an empty
database it inserts nothing, which is correct rather than a special case.

**Not wired into tenant registration.** A tenant created after this migration has no PCS until
someone creates one through the API. Adding it to the onboarding path is a change to tenant
creation, which belongs to whichever phase owns that flow; recorded here rather than done
quietly.

## Authorization and tenancy

`tenantId` always comes from the resolved session, never from a request body, query or cookie.
A unit belonging to another tenant answers exactly like one that does not exist, so the API
cannot be used to enumerate another tenant's catalogue.

Managing units reuses `canManageInventory` — tenant `OWNER`, or a store membership of
`STORE_MANAGER` / `INVENTORY_MANAGER` — rather than inventing a second vocabulary. The people
who may receive and adjust stock are the people who may say what a carton holds.

## Operations

| Operation | Service | API |
|---|---|---|
| Create unit | `createUom` | `POST /api/v1/uoms` |
| List units | `listUoms` | `GET /api/v1/uoms` |
| Create conversion | `createUomConversion` | `POST /api/v1/uoms/conversions` |
| List conversions | `listUomConversions` | `GET /api/v1/uoms/conversions` |
| Resolve conversion | `resolveConversion` | `POST /api/v1/uoms/convert` |
| Assign base unit | `assignProductBaseUom` | `PUT /api/v1/products/{id}/base-uom` |

No edit, delete, merge or archive. A unit that turns out to be wrong is a problem to solve when
someone actually has one, and deleting a unit that products and conversions point at is a
referential question this phase has no reason to answer.

## Deliberately not built

Inventory does not yet accept a unit. `receiveStock` still takes a base-unit quantity, and the
ledger is untouched — receiving "5 cartons" is the obvious next consumer and was left out so
this phase could not regress the inventory foundation it sits beside. Nothing in the sale path
changed either.

## Residual risk

The single-direction rule is enforced in the service, not by a constraint: nothing at the
database level stops `A -> B` and `B -> A` from both existing if two concurrent requests define
them in opposite directions. The constraint that would close it is a unique index on
`(tenantId, LEAST(fromUomId, toUomId), GREATEST(fromUomId, toUomId))`, which Prisma cannot model
and which would therefore show as permanent schema drift. Recorded rather than smuggled in.
