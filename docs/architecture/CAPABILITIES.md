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

---

# P1-8F — What is actually implemented

Added 2026-09-15. Everything above is the P1-7 specification and remains frozen. This section
records what the code does today, and — more usefully — which frozen rules it does **not** yet
enforce. Where the two disagree, this section describes reality; it does not amend the freeze.

Migration: `20260914190000_add_capability_model`.

## Storage

```
tenant_capabilities
  id          text primary key
  tenantId    text not null  -> tenants(id) on delete cascade
  capability  Capability not null
  enabled     boolean not null default true
  createdAt   timestamp(3) not null
  updatedAt   timestamp(3) not null

  unique (tenantId, capability)
```

`Capability` is a PostgreSQL enum: `RETAIL`, `WHOLESALE`, `MANUFACTURING`, `JOB_WORK`,
`PROCUREMENT`, `COMMERCE`, `DISTRIBUTION` — the seven the master plan names for this phase, fewer
than the frozen diagram's eventual list. An enum rather than free text because these are
authorization keys: a typo'd string would silently mean "no such capability", and the safest
failure mode for an authorization key is that the database refuses to store it. The cost is that
adding a capability needs a migration, which is the right friction for a list that changes once a
year.

The identifiers are the enum member names, uppercase, matching `BusinessType` and every other enum
in this schema rather than the frozen table's illustrative lowercase `key`. They are stable and
never display labels — they live in the database, in backend checks, in API responses and in audit
metadata, so renaming one is a data migration. Rendering "Job Work" for `JOB_WORK` is the caller's
business.

`@@unique([tenantId, capability])` is the whole integrity story: two rows for one tenant and
capability could disagree about whether a module is on, and a check reading "one of them" would be
non-deterministic. Proven by a raw Prisma insert that fails with `P2002`.

No composite `(id, tenantId)` foreign key as elsewhere in this schema, because there is nothing to
protect — `tenantId` here is the parent itself, not a sibling that could belong to another tenant.
A cross-tenant capability row is not a state the shape can express.

`enabled` is the single authority. A missing row means never configured, therefore off;
`enabled = false` means configured and switched off. Both read as "off" to every caller. They stay
distinct because deleting on disable would erase the record of the module ever having been on.
**Disable is an update, never a delete** — the frozen "hides and blocks, does not delete" rule at
the row level.

## Defaults, and what existing tenants received

Every tenant — existing and new — has **`RETAIL`, enabled. Nothing else.**

The migration backfills `RETAIL` onto every existing tenant; `DEFAULT_CAPABILITIES` grants the same
list to every new tenant inside the registration transaction. A tenant registered last month and
one registered tomorrow are therefore indistinguishable to the gate.

Deliberately **not** derived from `Tenant.businessType`. Every tenant can ring up a sale today
whatever type they picked at registration, so granting by business type would switch POS off for a
tenant whose type says WHOLESALE but who sells over a counter. That is exactly the accidental break
the backfill exists to prevent.

Nothing else is granted, because nothing else is implemented. Granting WHOLESALE by default would
assert a module the tenant does not have and cannot use.

The grant is seeded in the same transaction as the tenant row: a tenant that committed without its
capabilities would be a tenant whose POS is off, and no crash between two statements should be able
to produce that.

## The authoritative check

`src/server/capability/capabilityService.ts` is the only place that reads or writes capability
state. Domain services ask it; none queries `tenant_capabilities` directly.

```ts
hasCapability(tenantId, capability): Promise<boolean>
requireCapability(tenantId, capability): Promise<CapabilityGateResult>
listCapabilities(tenantId): Promise<CapabilityState[]>
setCapability({ actor, capability, enabled, correlationId })
seedDefaultCapabilities(tx, tenantId)
```

A check scattered into twelve services becomes twelve slightly different checks, and the one that
forgets `enabled === false`, or treats a missing row as permissive, is a hole nobody finds by
reading any single file.

`hasCapability` is true only when a row exists **and** `enabled` is true. A missing row is false:
the safe answer to "we have no idea" is no, and a capability appearing after a partial migration
must not switch a module on by accident.

`listCapabilities` returns all seven with their state, including those with no row, reported as
disabled — a caller asking "what does this tenant have" wants the whole picture.

Activation is idempotent, as frozen: re-enabling an enabled capability succeeds and reports
`changed: false`.

## tenantId

Always from authenticated server context — never a request body, query string, URL segment or
client state. The capability endpoints have no tenant parameter at all, which is the isolation
guarantee in its strongest form: Tenant A cannot ask about Tenant B because the request has nowhere
to put "B".

## Who may change configuration

**Tenant `OWNER`, and only tenant `OWNER`.**

Not `canManageInventory` — a `STORE_MANAGER` who may define units and move stock has no business
switching a whole module on for the company. Capabilities are tenant-wide configuration, so the
authority is the tenant-wide role. `TenantRole` is `OWNER | STAFF`, so `OWNER` is the strongest
role the existing model has. No new role, permission matrix or RBAC layer was introduced.

Tested: a STAFF user is refused, and a STAFF user who is `STORE_MANAGER` of the store is still
refused.

## Enforcement and error semantics

The gate is proven on one real operation: **`createSale` requires `RETAIL`**.

| Situation | Service result | HTTP |
|---|---|---|
| Enabled, user authorized | sale proceeds | 201 (200 on replay) |
| Capability disabled | `capability_disabled` | **404 `not_found`** |
| Enabled, user not authorized | `forbidden` | 403 |
| Both fail | `capability_disabled` | 404 |

**404, not 403**, following the frozen rule: a disabled capability produces the same response as an
unknown route, because whether a tenant has a module is not something their API surface should
volunteer. A 403 naming the capability would turn every endpoint into an oracle for which modules a
tenant holds. The service result keeps the distinction for logs and in-process callers; the
boundary flattens it.

The gate sits at the domain boundary, not in a route, so a direct HTTP call fails exactly as a click
would — invariant I-11. When it refuses, **nothing is written**: no sale, no stock movement, no
outbox event, asserted by test.

Two ordering decisions inside `createSale`:

- **After the idempotency replay.** A committed sale is a fact; returning its receipt is a read, and
  switching the module off afterwards does not un-sell it.
- **Before authorization.** "This tenant does not have this module" is the more fundamental refusal
  — asking which cashier may ring up a sale is meaningless when the business does no retail. This
  matches the frozen order: capability gate, then RBAC gate.

## What is deliberately not gated

Pricing, inventory and UOM operations are **not** capability-gated. They are the shared foundations
of the table above, used by every module; gating them behind RETAIL would break a tenant the moment
it enabled wholesale and disabled retail.

No fake business endpoints were created for WHOLESALE, MANUFACTURING, JOB_WORK, PROCUREMENT,
COMMERCE or DISTRIBUTION. **Those capabilities exist as flags and nothing more — the flag existing
does not mean the module is implemented.** The reusable gate is proven through the one domain that
genuinely exists, plus targeted tests of `requireCapability` itself.

## Frozen rules NOT yet enforced

Recorded plainly, because a half-built gate that looks complete is worse than an obvious gap:

1. **The dependency graph is not enforced.** `Commerce requires Retail or Wholesale`,
   `Job Work requires Manufacturing`, `Procurement requires Manufacturing`,
   `Distribution requires Wholesale` — none is checked. Any capability can currently be enabled
   alone.
2. **"Retail or Wholesale is mandatory" is not enforced.** An owner can today disable RETAIL and be
   left with no selling capability at all.
3. **In-flight work is not checked on disable.** The frozen rule that a disable with open work
   orders is refused with a list has nothing to refuse yet — no capability but RETAIL owns any
   process.
4. **No plan/billing entitlement check.** Out of scope by instruction; there is no billing.
5. **No ERP provisioning step.** No adapter exists.
6. **No `CapabilityEnabled` outbox event.** The frozen activation flow marks it PLANNED and it stays
   planned; nothing downstream consumes it.

Items 1–3 become enforceable, and should be enforced, when a second capability gains a real
implementation. Enforcing them now would mean validating a graph whose nodes do not exist.

## Auditability

Capability changes ride the **existing** `AuditLog` trail. No new audit system was built.

- `TenantCapabilityEnabled` / `TenantCapabilityDisabled`, with `metadata.capability`, `userId` and
  `correlationId`.
- Written only when the state actually changed; a no-op re-set writes nothing.
- A refused (unauthorized) attempt writes nothing.

**Known limitation, inherited and real:** `writeAuditLog` uses the global Prisma client, so the
audit row is written *outside* the mutation. If the process dies between the two, the record and the
fact disagree. This is the documented pre-existing `AuditLog` trade-off (see the schema comment
above `OutboxEvent`); P1-8F did not change it and did not make capability changes transactional
domain events.

## API

| Method | Path | Who |
|---|---|---|
| `GET` | `/api/v1/capabilities` | any authenticated member of the tenant |
| `PUT` | `/api/v1/capabilities/{capability}` | tenant `OWNER` only |

`GET` is readable by any member: knowing which modules your own employer has switched on is not
sensitive, and a staff user whose screen depends on it should not need owner rights. An unknown
capability identifier on `PUT` is a 404 on the URL, not a silent no-op — a typo must not look like a
successful change.

## Concurrency

`setCapability` upserts rather than read-then-inserting, so two owners toggling the same capability
at once cannot leave two rows; the unique index is what makes the upsert safe. Tested with
concurrent writers.
