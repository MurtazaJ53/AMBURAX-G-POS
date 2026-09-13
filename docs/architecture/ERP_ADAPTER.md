# AMBURAX — ERPNext Adapter Boundary

Frozen 2026-09-13 (P1-7). **No adapter exists yet.** This is the contract the first one must
satisfy. Placement and the two-database decision are settled separately in
`ERPNEXT_ARCHITECTURE.md` (ADR-076/077/078); this document freezes the boundary.

## The rule

```text
Frontend
   ↓
AMBURAX Domain / API              knows business language only
   ↓
ERPNext Adapter                   the only component that knows ERPNext exists
   ↓
ERPNext (MariaDB, per-site)
```

These must never know ERPNext implementation details: the frontend, AI tools, commerce
connectors, and the retail, wholesale, manufacturing and job-work domains. "Details" means
the REST surface, doctype names and field names, site identifiers, credentials, version
differences, retry policy and error shapes.

**Why this is worth the indirection:** ERPNext is a large external system on its own release
cadence. Without a boundary, its field names become our function signatures, its outages
become our domain errors, and a version upgrade becomes a cross-codebase refactor. With a
boundary, an upgrade is one module's problem.

## Interface shape

The adapter exposes business intentions, not ERPNext operations. Illustrative and
deliberately not exhaustive:

```text
postSale(tenant, sale)              -> { erpInvoiceId }        idempotent on sale.idempotencyKey
postPayment(tenant, payment)        -> { erpPaymentId }        idempotent on payment id
readStock(tenant, warehouse, sku)   -> { quantity, asOf }      read-through, cacheable
provisionSite(tenant, plan)         -> { siteId, status }      idempotent on tenantId
provisionWarehouse(tenant, store)   -> { warehouseId }         idempotent on storeId
```

Frozen signature rules:

1. **Inputs and outputs are AMBURAX types.** No doctype JSON crosses the boundary outward.
2. **Every mutating call takes an idempotency key derived from an AMBURAX fact** — the same
   discipline the outbox uses. Retrying must be safe by construction, because the network
   will make us retry.
3. **Returns are mapping keys, not copies.** `erpInvoiceId` is stored; the invoice document
   is not duplicated into PostgreSQL (invariant I-10).
4. **No call is fire-and-forget.** Either it completes, or it produces a durable record that
   something must retry.

## Error strategy

The adapter translates. Domain code sees a closed set:

| Adapter error | Meaning | Caller's expected response |
|---|---|---|
| `ErpUnavailable` | Transport/timeout/5xx | Retry later; never treat as success |
| `ErpRejected` | ERP validated and refused | Surface to the user; do not retry unchanged |
| `ErpConflict` | Duplicate or state conflict | Reconcile using the idempotency key |
| `ErpNotProvisioned` | Tenant has no site/company yet | Provisioning gap, not a user error |
| `ErpVersionUnsupported` | Site version outside the pin | Operational escalation |

**A timeout is never a success.** `DISASTER_RECOVERY.md` already states this as a product
rule; here it is the adapter's job to make it structurally true — an ambiguous outcome
resolves to `ErpUnavailable` plus a reconciliation obligation, never to a posted invoice.

## Retry, backoff and idempotency

- Retries live in the adapter and in the outbox, not scattered through domain code.
- Exponential backoff with a ceiling, as the outbox dispatcher already implements.
- Every retry replays the same idempotency key, so ERPNext's own duplicate handling and our
  mapping table agree on one outcome.
- Where ERPNext cannot be made idempotent for an operation, the adapter must implement a
  claim-check: record intent before the call, resolve it after, and reconcile on restart.

## Mapping strategy

One table per mapped entity kind, or one generic mapping table with a discriminator, holding:
`tenantId`, AMBURAX id, ERP site, ERP doctype, ERP name/id, sync state, last error, updated
timestamp. Mapping rows are AMBURAX-owned, tenant-scoped, and never carry business values
that ERPNext masters.

Today this exists only as reserved columns: `Tenant.erpnextSiteId`,
`Store.erpnextWarehouseId`, `Sale.erpInvoiceId`, all null, with
`erpnextProvisionStatus = NOT_PROVISIONED`. That is the honest state and no screen may
describe it otherwise.

## Sync strategy

| Direction | Mechanism | Authority |
|---|---|---|
| AMBURAX → ERPNext | Outbox event → adapter call | ERPNext becomes authoritative for the resulting document |
| ERPNext → AMBURAX | Scheduled pull, or webhook if the deployment supports it | ERPNext wins for ERP-mastered fields |
| Reconciliation | Scheduled sweep comparing mapping state | Raises a case for a human; never auto-resolves money |

No distributed transaction, ever. The two databases reach agreement eventually, through the
outbox and the sweep. That is ADR-077's decision and this document does not reopen it.

## Version strategy

- A single supported ERPNext version range, pinned in `ERPNext_VERSION_PIN.md`.
- The adapter asserts the site's version on connect and refuses an unsupported one loudly
  rather than guessing at field compatibility.
- Version-specific behaviour lives behind the adapter interface, never in domain code.
- Upgrades are staged per placement, not platform-wide at once.

## Provisioning responsibilities

The adapter owns site and company provisioning mechanics; the control plane owns the
decision and the state machine ([PROVISIONING.md](PROVISIONING.md)). Provisioning calls are
idempotent on `tenantId`, because a retried provisioning must never create a second site.
