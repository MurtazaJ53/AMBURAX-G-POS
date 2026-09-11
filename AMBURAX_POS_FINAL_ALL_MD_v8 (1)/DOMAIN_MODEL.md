# AMBURAX POS — Domain Model

## Identity hierarchy (established through A1-A7)

```text
User
   |
   +-- Tenant / Business
          |
          +-- Store
          |     +-- Location / Warehouse
          |     +-- POS Devices   (PosDevice - built at A9)
          |
          +-- Members / Roles
```

These are deliberately separate concepts, not collapsed for onboarding-flow
convenience:
- **User** — a login identity, tied to exactly one Tenant (`User.tenantId`, required).
  Created at A6, not A5 — A5 creates a tenant with zero users attached. Carries
  `tenantRole` (OWNER/STAFF) — A6 sets the tenant's first user to OWNER; see
  PERMISSIONS.md for how this differs from `StoreMembership.role`.
- **Tenant / Business** — the business/company shell (name, business type, industry,
  country, tax id, contact info, onboarding progress). Created at A5.
- **Store** — a Tenant-scoped location/warehouse/terminal context, and deliberately the
  *only* Amburax-side location/warehouse model — see the Store section below and
  ERPNEXT_DOCTYPE_MAP.md's provisioning contract. Created at A7.
- **StoreMembership** — the join between a User and the Stores they can operate in
  (many-to-many with a role — already present since the original schema, confirmed
  correctly modeled at A7 rather than rebuilt). A7 creates the owner's first row
  (`role: 'OWNER'`) for their own store; this is what A12 (Store/Workspace Selection)
  will read to list a user's available stores. A11 creates one row per accepted
  invitation, with the invitation's role, for the invitation's store only; the
  `@@unique([userId, storeId])` constraint is what makes double-acceptance impossible
  even if the invitation claim were somehow bypassed.
- **OnboardingSession** — not part of the permanent hierarchy at all. A short-to-
  medium-lived, tenant-scoped (not user-scoped — no user exists yet) opaque
  credential that bridges an anonymous A5 registrant through A6-A10 until a real
  User and Session can exist. See AUTHENTICATION.md.

## PosDevice
A POS terminal bound to one Store - the fourth distinct entity in the hierarchy, and
deliberately none of the other three. Not a **User**: a device does not log in, carries no
role, and must be revocable without touching any person's identity. Not a **Store**: a store
has many terminals. Not a **Warehouse**: Store already is the Amburax-side warehouse concept.
Created at A9.

Its fields are four different kinds of thing and must not be conflated:
- **Identity** - server-assigned `id`, plus a merchant-facing `code` unique per store
  (`@@unique([storeId, code])`, so two stores may each have their own POS-01). Never derived
  from a browser fingerprint.
- **Credentials** - a one-time `pairingCodeHash` (short TTL, consumed at activation) and a
  long-lived `deviceSecretHash` (issued to the machine, never shown to a human). Both stored
  only as hashes. See DECISIONS.md ADR-065.
- **Configuration** - receipt header/footer and counter behaviour. Amburax-owned only; no
  invoice numbering, customer or price list (ADR-063).
- **Runtime** - `lastSeenAt`. Volatile, written by device-facing calls, never by the setup
  form. The full online/offline/syncing/reconciliation model belongs to the offline engine.

Status is derived from `activatedAt` / `disabledAt` / `pairingExpiresAt`, never stored:
PENDING_ACTIVATION, PAIRING_EXPIRED, ACTIVE, DISABLED. `createdAt` and `activatedAt` are
different facts - a configured row is not a paired terminal (ADR-062). Revocation is
`disabledAt`, never deletion, because sales will reference `posDeviceId` permanently
(ADR-066).

The future sale path this shape exists to serve keeps four identities separate:
`User (cashier) + StoreMembership + PosDevice + Shift -> POS Checkout`. Shift and Checkout
are not built; A9 establishes only the device leg.

## Tenant
Business/company identity. Onboarding progress (`OnboardingStep`: BUSINESS_CREATED →
OWNER_CREATED → STORE_CREATED → TEAM_INVITED → POS_CONFIGURED → COMPLETE) is tracked
independently of `TenantStatus` (ACTIVE/SUSPENDED, an operational switch) — see
DECISIONS.md ADR-036.

## Store
Tenant-scoped location, warehouse, timezone, policy and terminal context. Includes address,
store type (RETAIL/WAREHOUSE), currency, and `isDefault` (exactly one store per tenant is
default; a real, unexposed-as-a-toggle field until a second store makes it meaningful).
ERPNext Warehouse provisioning is tracked on the same row (`erpnextProvisionStatus`,
`erpnextWarehouseId`) rather than a separate Location/Warehouse table — see
ERPNEXT_DOCTYPE_MAP.md's provisioning contract and DECISIONS.md ADR-047.

## Product
Garment style/product.

## Variant
Size + color + SKU + barcode + pricing.

## Inventory
Location + variant:
on_hand, reserved, available, damaged, in_transit.

## Customer
Identity, history, segments, loyalty, notes.

## Khata
Customer receivable experience referencing ERPNext financial truth.

## Order
Normalized order with source/channel, external ID, customer, items, payment, fulfillment, shipment, return and refund.

## Channel
Account, capability, schema, listing, mapping, price, inventory policy, sync state.

## B2B
Lead, opportunity, follow-up, quotation, sales order, customer.

## Audit
Actor + tenant + store + action + timestamp + correlation ID + references.
