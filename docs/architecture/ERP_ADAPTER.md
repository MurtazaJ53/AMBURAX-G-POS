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

---

# P1-8I — the skeleton that exists

Added 2026-09-15. Everything above is the P1-7 freeze and stands unchanged. This section records
what is actually in the repository, and — more usefully — what is still absent.

**No ERPNext integration was built.** No customer, item, stock, invoice, payment, BOM or work
order is synced. What exists is the boundary those will later sit behind.

## Files

All under `src/server/erp/`, the location invariant I-5 already named.

| File | Responsibility |
|---|---|
| `errors.ts` | The normalized error model, retry classification, HTTP-status mapping |
| `config.ts` | Tenant → ERP environment resolution; the credential provider interface |
| `transport.ts` | The single interface describing "talk to a site"; transport-level failures |
| `fakeTransport.ts` | Scripted transport for tests. **Test support; no production import** |
| `client.ts` | Error normalization, version assertion, correlation, redaction, telemetry |
| `health.ts` | Read-only connectivity contract |

## Where ERPNext knowledge is allowed

```text
AMBURAX domain / API        business language only
      ↓
ErpClient                   statuses, envelopes, versions, redaction
      ↓
ErpTransport                HTTP, hosts, headers
      ↓
ERPNext site
```

Exactly two Frappe-specific strings exist in the codebase: the ping path in `health.ts`, and the
`path` field of `ErpRequest` that only a transport or a future port may construct. No doctype
name appears anywhere. No domain service imports anything from `server/erp/`.

## Tenant → ERP mapping

```text
AMBURAX Tenant  →  ERPNext Site  →  ERPNext Company
                        ↑
                   cluster/pool (many sites share one)
```

One tenant, one site, one database, by default. `companyId` is separate and optional, so a group
with two legal entities does not need two sites. `clusterId` names the infrastructure pool, so a
placement manager can later move a large tenant to dedicated capacity without any domain code
noticing. Neither "one cluster per tenant" nor "one shared site for everyone" is implemented.

## No database change was required

`Tenant.erpnextSiteId`, `Tenant.erpnextProvisionStatus`, `Store.erpnextWarehouseId`,
`Sale.erpInvoiceId` and `Sale.erpSyncStatus` already exist, reserved by earlier phases for exactly
this. This phase reads them. **No migration was created**, because a table with no rows and no
reader is a guess about a phase that has not been designed — the same reasoning that kept
`OrderAddressSnapshot` out of P1-8D.

The mapping table the freeze describes belongs to the first phase that actually maps something.

## Configuration and secrets

No credential is stored in PostgreSQL, and none appears in any persisted type. Credentials come
from `ErpCredentialProvider`; the only shipped implementation reads per-site environment
variables and is documented as development and test support, not a secret store. When a real
secret manager exists it implements that interface and nothing else changes.

A site with no credentials configured raises `configuration_error` rather than falling back —
a silent fallback here would mean unauthenticated calls to somebody's accounting system.

## Error model

Domain callers see five frozen categories. The adapter keeps thirteen finer kinds for retry
classification and logs; every kind maps to exactly one category through a total map, so adding
a kind without deciding its category is a compile error.

| Kind | Category | Retryable |
|---|---|---|
| `timeout`, `unavailable`, `server_error`, `rate_limited`, `malformed_response` | `ErpUnavailable` | yes |
| `authentication_failed`, `authorization_failed`, `not_found`, `validation_failed`, `configuration_error` | `ErpRejected` | no |
| `conflict` | `ErpConflict` | no |
| `not_provisioned` | `ErpNotProvisioned` | no |
| `unsupported_version` | `ErpVersionUnsupported` | no |

Authentication and authorization are refusals, not outages: wrong credentials do not fix
themselves, and retrying them burns the ERP's rate budget while hiding the real problem.

**A timeout is never a success.** `ErpError.ambiguous` is true for timeouts and garbled replies —
the call may have taken effect on the far side — and false for explicit refusals. That flag is
the reconciliation obligation, made structural.

## Retry

The client **does not retry**. It classifies, and `ErpError.retryable` tells the caller whether
another attempt is sound. Retrying belongs to the outbox dispatcher, which already implements
bounded exponential backoff. A retry loop hidden inside a client is how a struggling ERP becomes
a thundering herd, and how one user action becomes four invoices.

## Correlation and idempotency

- **AMBURAX-side:** the outbox's `idempotencyKey` is derived from a business fact, so a retried
  operation collides rather than duplicating.
- **Adapter-side:** `correlationId` and optional `causationId` travel with every request and
  appear in telemetry, so one action can be traced across both systems.
- **ERPNext-side:** nothing is assumed. ERPNext's own duplicate handling is not a guarantee this
  code relies on; where an operation cannot be made idempotent there, a future port must record
  intent before calling and resolve it after.

**Exactly-once is not claimed anywhere.** Delivery is at-least-once, and the idempotency key is
what makes that survivable.

## Version boundary

No ERPNext version has been frozen for this product. `ERPNext_VERSION_PIN.md` does not exist, so
this phase does not invent a commitment: `supportedVersions` is configuration with no default,
and an empty list means no assertion is performed. Supply a list and a site outside it is refused
with `ErpVersionUnsupported` rather than guessed at. Version-specific translation is later work
and lives behind `ErpClient`, never in domain code.

## Health

`not_provisioned` · `misconfigured` · `unauthenticated` · `unsupported` · `unavailable` ·
`connected`.

Distinct because the operational response to each differs: a provisioning queue item, a
deployment defect, a credential problem, an upgrade decision, wait-and-retry, and fine. The check
issues one read and **never mutates ERPNext**.

Every tenant today reports `not_provisioned`. No screen may describe that as connected or
pending sync.

## Licensing

- **ERPNext is GPLv3.** **Frappe Framework is MIT.**
- **Nothing was vendored.** No ERPNext or Frappe source is copied, cloned or embedded in this
  repository, and no dependency on either was added.
- AMBURAX must maintain an OSS inventory / SBOM covering everything it ships.
- **An API boundary is an engineering boundary, not a claim of automatic legal separation.**
  Whether a given deployment or distribution model creates a combined work is a legal question,
  not an architectural one.
- Self-hosting and distribution both require separate legal review before release. This document
  states the architecture and deliberately draws no legal conclusion beyond it.

## What is not built

Customer, item, stock, invoice, payment, BOM and work-order sync; webhooks; provisioning
mechanics; the mapping table; a real HTTP transport; a secret manager; placement and cell
orchestration; ERP migrations and upgrades. The skeleton exists so those can be added without any
of them reaching into the domain.
