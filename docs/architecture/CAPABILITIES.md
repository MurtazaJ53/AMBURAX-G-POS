# AMBURAX — Capability Architecture

Frozen 2026-09-13 (P1-7). Specification only: no capability storage or gate exists today.

## The rule being frozen

A capability is **tenant configuration over one shared domain core**. It is not a product,
not a database, not a separate deployment, and not a reason to fork a domain model.

```text
Tenant
 ├── Retail          ├── Distribution
 ├── Wholesale       ├── Franchise
 ├── Manufacturing   ├── Service
 ├── Job Work        ├── Projects
 └── Commerce
```

A small retailer runs Retail alone. A garment manufacturer runs Retail + Wholesale +
Manufacturing + Job Work + Commerce. Both run the same code against the same schema; the
difference is a row of configuration and the screens and endpoints that row unlocks.

**What this forbids, explicitly:** `RetailProduct` / `WholesaleProduct`,
`RetailInventory` / `ManufacturingInventory`, a "wholesale mode" schema, or a second
customer model for B2B. If two capabilities need different *behaviour* over the same noun,
that is a field, a policy or a strategy object — not a second noun. See
[SHARED CORE](#the-shared-core-capabilities-consume).

## Capability definition

Each capability is defined by, and frozen as, this shape:

| Attribute | Meaning |
|---|---|
| `key` | Stable identifier, e.g. `wholesale`. Never renamed. |
| `requires` | Capabilities that must be on for this one to function |
| `unlocks` | Domain services, API routes and navigation entries it gates |
| `erpDependencies` | ERPNext doctypes the capability needs provisioned |
| `dataOnDisable` | What happens to existing data when it is switched off |

## Dependencies

```text
Retail ──────────────┐
                     ├──> Commerce        (needs sellable catalogue + stock)
Wholesale ───────────┘

Manufacturing ──> Job Work                (job work is outsourced production)

Manufacturing ──> Procurement             (raw material cannot be assumed)

Distribution ──> Wholesale                (distribution is wholesale at scale)
```

Frozen rules:

1. **Retail or Wholesale is mandatory.** A tenant with neither has nothing to sell and no
   reason to exist in this system.
2. **Dependencies are hard.** Enabling a capability whose prerequisite is off is refused,
   not silently satisfied by turning the prerequisite on.
3. **No capability may introduce a second authoritative record** for anything another
   capability already owns. This is invariant I-2 restated at the capability level.

## Activation

```text
request to enable
  -> control plane validates dependency graph
  -> control plane checks plan/billing entitlement
  -> ERP prerequisites provisioned through the adapter (idempotent)
  -> capability row written
  -> CapabilityEnabled event emitted (PLANNED)
  -> gates open at API and navigation
```

Activation is idempotent: enabling an already-enabled capability is a no-op that returns
success, because retries and double-clicks are ordinary.

## Deactivation and data retention

Frozen and deliberately conservative:

1. Disabling a capability **hides and blocks**, it does not delete. Historic transactions
   remain queryable; their reports stay reachable.
2. Any in-flight process the capability owns must be closed or explicitly abandoned first —
   a disable request with open work orders is refused with a list, not forced.
3. Financial history is never removed by a configuration change. Accounting consequences
   belong to ERPNext and are not AMBURAX's to withdraw.
4. Re-enabling restores access to the retained data rather than starting empty.

## Authorization and gating

Capability and permission are different questions and are asked in this order:

```text
authenticate
  -> resolve tenant (server-side)
  -> is the capability enabled for this tenant?      <- capability gate
  -> does this actor hold the permission?            <- RBAC gate
  -> is the resource inside the actor's scope?       <- scope gate
  -> execute domain operation
```

A disabled capability produces the same response as an unknown route, not a permission
error: whether a tenant has bought a module is not information their API surface should
volunteer.

**Gating is server-side.** Navigation hiding is presentation. The enforceable gate sits at
the API and domain boundary (invariant I-11).

## The shared core capabilities consume

Frozen as one set of foundations, owned by the platform and shared by every capability:

| Foundation | Status today | Notes |
|---|---|---|
| Product / Variant / SKU | **Implemented** | `Product`, `ProductVariant`; canonical identity is AMBURAX's (ADR-005) |
| UOM | **Missing** | Single implied unit today. Required before Manufacturing or Procurement. |
| Warehouse / location | **Partial** | `Store` is the location concept; ERPNext Warehouse is the ERP counterpart, unprovisioned |
| Inventory | **Partial** | `StockLevel` per (store, variant), a projection — not a ledger |
| Batch / Lot / Serial | **Missing** | Required by Manufacturing, Job Work and any expiry-bearing goods |
| Customer | **Implemented** | `Customer`, tenant-scoped |
| Supplier | **Missing** | ERPNext-mastered when it arrives |
| Pricing | **Partial** | One price per variant; no price list, tier or contract pricing |
| Tax | **Partial** | Per-variant rate in basis points; ERPNext owns the tax framework |
| Credit / receivable | **Missing** | Khata UX is AMBURAX's; the balance is ERPNext's |
| Addresses | **Missing** | Store address is inline fields, not an address entity |
| Orders | **Missing** | `Sale` is an immediate retail transaction, not an order with a lifecycle |
| Fulfilment | **Missing** | No pick/pack/dispatch concept |
| Procurement | **Missing** | ERPNext-mastered |
| Finance references | **Partial** | `erpInvoiceId`, `erpSyncStatus` reserved and unused |

This table is the honest gap list behind [P1_7_FREEZE.md](P1_7_FREEZE.md) §"Next phase": it
says which foundations must exist before Wholesale, Manufacturing or Job Work can be built
without duplicating a core.

## Migration requirements

When a capability is built, it may add tables — it may not fork existing ones. Concretely:

- Adding `Order` for Wholesale is correct. Adding `WholesaleCustomer` is not.
- Adding `BOM`, `WorkOrder`, `JobWorkChallan` is correct. Adding `ManufacturingProduct` is
  not.
- Adding an `ownership` discriminator to stock so customer-owned and company-owned material
  are distinguishable is correct. Adding `JobWorkInventory` is not.
