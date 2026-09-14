# AMBURAX — Address Foundation

Established by P1-8D, 2026-09-14. Migration `20260914140000_add_address_foundation`.

## The models

**`Address`** — a postal address owned by a tenant: `line1`, `line2?`, `city`, `state`,
`postalCode`, `country`, `contactName?`, `contactPhone?`, `type`, `isActive`.

**`CustomerAddress`** — which customer an address belongs to. A real join table, unique per
`(customerId, addressId)`.

**`Customer.gstin`** — nullable, for a customer who buys as a business.

**`Customer.defaultBillingAddressId` / `defaultShippingAddressId`** — nullable pointers.

### Why not polymorphic

There is no `ownerType`/`ownerId` pair on `Address`. A string discriminator cannot be a foreign
key, so the database could not distinguish a customer address from a supplier one, and nothing
would stop a row pointing at an id that does not exist. When suppliers arrive they get a
`SupplierAddress` table of the same shape.

### Why a join table rather than `Address.customerId`

The same physical address legitimately serves more than one relationship — a group buyer's
shared godown, a common delivery point. The join says so directly, and the next owner kind gets
its own table instead of a column on `Address` that would be null most of the time.

## Address types

`BILLING` · `SHIPPING` · `BOTH`

Three, not more. A wholesale buyer's invoice goes to their registered office and the goods go to
a warehouse, and very often both are the same place. Finer categories (registered office,
branch, godown) are labels a business can keep in `contactName` until something in the system
actually branches on them.

## The default rule

Defaults are **two nullable pointers on the customer**, not a flag on the address.

A column holds exactly one value, so "two conflicting default billing addresses" is not a state
the database can represent. There is nothing to race, nothing to reconcile, and no constraint
needed to forbid it. Setting a default is one `UPDATE`; the previous default is replaced by
being overwritten, and the last writer wins — correct semantics for "which address should we
use", where a stale answer is wrong but not corrupt.

The alternative would have been an `isDefault` flag plus a partial unique index
(`WHERE isDefault`), which Prisma cannot express without permanent schema drift and which would
fail the CI drift gate.

Rules enforced when choosing a default:

- the address must be **linked to that customer** — not merely to the tenant;
- it must be **active**;
- its type must be **compatible**: `BILLING` or `BOTH` for billing, `SHIPPING` or `BOTH` for
  shipping. A billing address cannot become the shipping default, because sending goods to an
  accounts office is a mistake worth refusing.

## Deactivation, not deletion

Addresses are retired by `isActive = false`. Retiring one that is still a customer's default is
**refused** rather than silently clearing the pointer: a customer who quietly loses their
delivery address discovers it at the worst possible moment. Choose a new default first.

## Snapshot rule for the Order phase

**Not implemented here, and load-bearing later.**

When `Order` exists, the selected billing and shipping addresses must be **copied into the order
as an immutable snapshot** at the moment the order is placed — the same discipline `SaleItem`
already uses for `skuSnapshot` and `nameSnapshot`.

Editing a customer's address afterwards must never rewrite where something was already shipped.
An order records where the goods actually went; an address record says where the customer is
today. Those are different facts, and conflating them turns a delivery dispute into an
unanswerable question.

This is why `updateCustomerAddress` edits in place today: nothing references an address
historically yet, so there is no history to protect. The moment orders exist, that stops being
true — and the snapshot, not a copy-on-write address, is the answer.

No `OrderAddressSnapshot` table is created now. An unused table is a guess about a phase that
has not been designed.

## Tenant safety

`tenantId` always comes from the resolved session. Both relations on `CustomerAddress` are
composite — `(customerId, tenantId)` and `(addressId, tenantId)` — as are the two default
pointers on `Customer`, so PostgreSQL rejects any cross-tenant pairing regardless of what the
calling code believes. Proven by integration tests that bypass the service and insert directly.

Another tenant's customer or address answers exactly like one that does not exist, so the API
cannot be used to discover whether a record belongs to someone else.

## Validation

Server-side, permissive about shape and strict about presence. `line1`, `city`, `state`,
`postalCode` and `country` are required; whitespace is collapsed and trimmed.

`country` is the one strict field — ISO-3166 alpha-2, uppercased — because later tax and
shipping logic will branch on it, and a free-text "India"/"IN"/"Bharat" mix would make that
impossible. `postalCode` accepts up to 16 characters of letters, digits, spaces and hyphens, so
an Indian PIN, a Canadian code and a US ZIP+4 all fit; six-digit-only validation would have been
correct today and wrong the first time a tenant ships abroad.

`state` is free text. No GST state code, deliberately: that belongs to the tax engine, which
does not exist, and adding it later is one nullable column.

## GSTIN

A 15-character shape check against the documented layout, stored uppercase. **Not a
verification** — no government lookup, no registry check, no check-digit computation. Claiming
otherwise would be exactly the kind of false capability P1-3 removed from this product.

Deliberately **not unique**: two tenants keep independent customer books and may both sell to the
same firm.

## Store addresses are untouched

`stores.addressLine` / `city` / `state` / `postalCode` / `phone` remain inline columns.
Migrating them into this system is a change to onboarding, which this phase does not own.

## Operations

| Operation | Service | API |
|---|---|---|
| Create address for customer | `createCustomerAddress` | `POST /api/v1/customers/{id}/addresses` |
| List customer addresses | `listCustomerAddresses` | `GET /api/v1/customers/{id}/addresses` |
| Update address | `updateCustomerAddress` | `PUT /api/v1/customers/{id}/addresses/{addressId}` |
| Retire address | `deactivateAddress` | `DELETE /api/v1/customers/{id}/addresses/{addressId}` |
| Set default billing/shipping | `setDefaultAddress` | `PUT /api/v1/customers/{id}/default-address` |
| Set/clear GSTIN | `setCustomerGstin` | `PUT /api/v1/customers/{id}/gstin` |
| Link an existing address | `linkAddressToCustomer` | service only |

Authorization matches customer management — any authenticated user of the tenant, resolved
server-side, exactly as `createCustomer` already works. A separate address permission would be
inventing RBAC this codebase has not decided on.
