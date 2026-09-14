# AMBURAX — Pricing Foundation

Established by P1-8E, 2026-09-14. Migration `20260914170000_add_pricing_foundation`.

## The models

**`PriceList`** — `{tenantId, name, currency, isActive}`, unique per `(tenantId, name)`.

**`PriceListItem`** — `{priceListId, variantId, uomId, minQuantity, unitPriceMinor, validFrom?, validTo?}`,
unique per `(priceListId, variantId, uomId, minQuantity)`.

**Three nullable pointers** — `Customer.priceListId`, `Store.priceListId`,
`Tenant.defaultPriceListId`. All composite-FK'd to `(id, tenantId)`.

`uomId` is **required**, not nullable. Half domain: a price without a unit is meaningless once
units exist — 950 for a piece and 950 for a carton are different businesses. Half PostgreSQL:
NULLs are distinct in a unique index, so a nullable unit column would silently permit unlimited
duplicate rows for the same variant and break, defeating the one constraint this table needs.

## The resolution chain

```
customer's price list → store's price list → tenant default → ProductVariant.priceMinor
```

**Each step falls through on "no applicable item", not on "no list assigned".** A customer with a
negotiated list that carries no price for this variant, or whose lowest break is 50 when 10 were
asked for, or whose price expired yesterday, gets the store's price. Stopping at the first
assigned list is the obvious bug here, and the fall-through is tested at every step including the
case where all three lists exist and all three are empty.

The final step, `ProductVariant.priceMinor`, is unchanged and still the price every existing sale
uses.

## Quantity breaks

Rows, not a table. The **highest `minQuantity` that does not exceed the requested quantity** wins:

| breaks at 1, 10, 50 | resolves to |
|---|---|
| 1, 9 | the 1 break |
| 10, 49 | the 10 break |
| 50, 1000 | the 50 break |

A quantity below every break means the list has no answer — fall through.

## Validity windows

`validFrom` and `validTo`, both nullable, both **inclusive**. Both null — the ordinary case —
means always. A price valid "from today" applies today; one valid "to the 31st" applies on the
31st. `validFrom <= validTo` is enforced.

This is a validity window, **not a schedule**. Nothing activates a price as a campaign, no job
flips these over, and there are no promotions, coupons, schemes, free quantity or loyalty
anywhere in this phase.

## Currency — never converted

A price list carries a required ISO-4217 currency. A list in one currency does not apply to a
store selling in another, and this is **refused explicitly**, not silently skipped:

- **At assignment**, giving a store a list in another currency is rejected immediately.
- **At resolution**, a mismatched list returns `currency_mismatch` rather than falling through.

Falling through would be indistinguishable from "no price configured", and the merchant would
never learn that the price list they carefully built is being ignored. There is no FX engine and
this field does not imply one — it exists so that when a second currency appears, the existing
rows already say which one they meant.

## Zero price

`unitPriceMinor = 0` is valid and means exactly what it says: a deliberately free line. Negative
is rejected; fractional is rejected (money is integer minor units everywhere). Zero is **not** a
promotion or free-quantity mechanism, and nothing treats it as one.

## Duplicate protection, and the one limitation

**Enforced by the database:** one row per `(priceList, variant, uom, minQuantity)`. A raw insert
of a duplicate break fails with a unique violation; the test proves it.

**Enforced by the service:** a second price for the same break must not describe a *different,
non-overlapping* period. Because the unique key holds one row per break, a disjoint second window
would silently overwrite a price that is still in force for its own period — so it is refused.
Two overlapping windows (the common case: two open-ended prices) are a replacement, which is the
intent.

**The limitation, stated honestly:** overlap prevention is not a database constraint. PostgreSQL
could express it as an exclusion constraint over a range type with `btree_gist`, but Prisma cannot
model one, and the migration would register as permanent schema drift — failing the CI drift gate
added in P1-8A. It is therefore checked in the service, inside a transaction that first takes
`pg_advisory_xact_lock` on the break, which makes it safe under concurrency rather than a
read-then-write race. Two concurrent writers of the same break provably leave exactly one row.

If the drift constraint is ever relaxed — a Prisma release that models exclusion constraints, or
an accepted baseline migration — this is the first thing to promote into the database.

## Tenant safety

`tenantId` always comes from the resolved session. Every reference — list, variant, unit,
customer, store — is resolved within the tenant, and a foreign one answers exactly like one that
does not exist. Four composite foreign keys mean PostgreSQL rejects a cross-tenant pairing even if
the calling code were wrong; all four are proven by tests that bypass the service.

## Authorization

Reuses `canManageInventory` — tenant OWNER, `STORE_MANAGER` or `INVENTORY_MANAGER`. The people who
may define units and move stock are the people who may say what goods cost. It is emphatically not
a till operation, and a cashier is refused.

## Operations

| Operation | Service | API |
|---|---|---|
| Create price list | `createPriceList` | `POST /api/v1/price-lists` |
| List price lists | `listPriceLists` | `GET /api/v1/price-lists` |
| Set a price / break | `setPriceListItem` | `POST /api/v1/price-lists/{id}/items` |
| List prices | `listPriceListItems` | `GET /api/v1/price-lists/{id}/items` |
| Set tenant default | `setTenantDefaultPriceList` | `PUT`/`DELETE /api/v1/price-lists/{id}/default` |
| Assign to customer | `assignCustomerPriceList` | `PUT /api/v1/customers/{id}/price-list` |
| Assign to store | `assignStorePriceList` | `PUT /api/v1/stores/{id}/price-list` |
| Resolve a price | `resolvePrice` | `POST /api/v1/pricing/resolve` |

## Deliberately not wired into checkout

`saleService` is untouched. A sale still prices from `ProductVariant.priceMinor`, and a tenant
with a price list configured sells at exactly the same price as before — asserted by a regression
test that configures a 1-paisa list and confirms the sale still charges the variant's price.

Changing how a sale is priced changes Sale semantics, which this phase was told to preserve and
which belongs to the Order phase (P1-8G). The foundation exists and is server-authoritative; the
consumer comes next.
