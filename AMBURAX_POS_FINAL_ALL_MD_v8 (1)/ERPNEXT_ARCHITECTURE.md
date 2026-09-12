# AMBURAX POS — ERPNext / MariaDB ARCHITECTURE DECISION (P1-7)

Decision date: 2026-09-12
Status: **DECIDED for the boundary. Two items remain open and are named in §14.**
Scope: analysis and decision only. No ERPNext, Frappe or MariaDB is installed, and no
implementation code was written for this decision.

> **Read this first.** Everything below separates three different things, and conflates
> them nowhere:
> **[TARGET]** the architecture we are designing toward · **[BUILT]** what exists in the
> repository today · **[FUTURE]** infrastructure not yet provisioned or benchmarked.

---

## 0. Why this document exists

`MariaDB` appears in **zero** of the original architecture documents. ARCHITECTURE.md,
DATABASE_STRATEGY.md, DATA_STRATEGY.md, TENANT_ROUTING.md, SCALABILITY.md and
MICROSERVICES.md all describe ERPNext as a component while never acknowledging that
Frappe/ERPNext requires **MariaDB**, and that AMBURAX runs **PostgreSQL**. The system is a
two-database architecture and no document said so.

That omission is the whole of P1-7. Until it is settled, the first ERPNext write path
cannot be designed correctly, because nobody has written down which database holds which
truth or what happens when one of them commits and the other does not.

### Two documents named in the P1-7 brief do not exist

`LICENSE_POLICY.md` and `ERPNEXT_LICENSE_AND_CODE_BOUNDARY.md` are **not present** in this
repository. The nearest actual file is `LICENSE_RECONCILIATION.md`, which is what §10 below
reconciles against. No content was invented to stand in for the missing files.

---

## 1. Final recommended topology — TIERED

**[TARGET]**

```text
                         +--------------------------------------+
                         |  AMBURAX CONTROL PLANE (proprietary) |
                         |                                      |
   Browser / POS ------> |  Next.js app + API (Route Handlers)  |
   terminal / mobile     |  Identity - Tenant router - Authz    |
                         |  Outbox producer + dispatcher        |
                         +------------------+-------------------+
                                            |  (server-side only)
                         +------------------v-------------------+
                         |   AMBURAX PostgreSQL   [BUILT]       |
                         |   tenants - users - sessions - stores|
                         |   memberships - invitations - devices|
                         |   audit_logs - outbox_events         |
                         +------------------+-------------------+
                                            |
                         +------------------v-------------------+
                         |  ERPNext ADAPTER (proprietary) [FUTURE]|
                         |  the ONLY code that speaks ERPNext   |
                         |  typed commands / typed read models  |
                         +---+--------------+---------------+---+
                             |              |               |
      -- TIER 1 -------------v--   -- TIER 2 v--   -- TIER 3 v-------------
      Shared ERPNext bench        Dedicated bench   Dedicated bench +
      Many Frappe SITES,          for one tenant    isolated infrastructure
      one site per tenant                           (own host/VPC/region)
             |                          |                     |
      +------v------+          +--------v------+     +--------v--------+
      |  MariaDB    |          |   MariaDB     |     |    MariaDB      |
      | one DB per  |          |  one DB per   |     |   dedicated     |
      | site        |          |  site         |     |   instance      |
      +-------------+          +---------------+     +-----------------+
        small tenants            large tenants          enterprise
```

**The unit of ERPNext tenancy is the Frappe *site*, at every tier.** Frappe already gives
each site its own MariaDB database and its own credentials. The tiers differ only in *how
much infrastructure a site shares with other sites* — never in the logical model. That is
what makes promotion between tiers a migration rather than a redesign.

---

## 2. Responsibility matrix

| Concern | AMBURAX (PostgreSQL) | ERPNext (MariaDB) |
|---|---|---|
| Authentication, sessions, MFA | **Owns** [BUILT] | Never |
| Users, roles, store membership | **Owns** [BUILT] | Never |
| Tenant identity, onboarding state | **Owns** [BUILT] | Never |
| POS terminal identity, pairing | **Owns** [BUILT] | Never |
| Invitations, reset tokens, OTP | **Owns** [BUILT] | Never |
| Audit trail of user actions | **Owns** [BUILT] | Has its own; not merged |
| Outbox / side-effect dispatch | **Owns** [BUILT] | Never |
| Channel mappings, connector state | **Owns** [TARGET] | Never |
| Allocation policy, AI artifacts | **Owns** [TARGET] | Never |
| Read models, search indexes | **Owns (rebuildable)** [TARGET] | Never |
| Item / variant / price list | Read model only | **Authoritative** [TARGET] |
| Stock ledger, stock entries | **Never stores** | **Authoritative** [TARGET] |
| Sales Invoice, Payment Entry | **Never stores** | **Authoritative** [TARGET] |
| GL, receivables, payables, tax | **Never stores** | **Authoritative** [TARGET] |
| Invoice numbering series | **Never stores** (ADR-063) | **Authoritative** [TARGET] |
| Supplier, purchase documents | **Never stores** | **Authoritative** [TARGET] |

---

## 3. Tenant / site mapping model

**[TARGET]** — the schema columns backing this already exist **[BUILT]**.

| AMBURAX | ERPNext | Cardinality | Backing column |
|---|---|---|---|
| `Tenant` | Frappe **site** | 1 : 1 | `Tenant.erpnextSiteId` [BUILT, always null today] |
| `Tenant` | ERPNext **Company** | 1 : 1 | *(none yet — see §14-A)* |
| `Store` | ERPNext **Warehouse** | 1 : 1 | `Store.erpnextWarehouseId` [BUILT, always null today] |
| `PosDevice` | *(nothing)* | — | deliberately none (ADR-064) |
| `User` | *(nothing)* | — | identity is never delegated (ADR-002) |

### Resolving the Store -> "Warehouse / Company setup" ambiguity

ERPNEXT_DOCTYPE_MAP.md maps Store to "Warehouse / **Company setup**". Company and Warehouse
are very different objects in ERPNext — a Company owns a Chart of Accounts, a Warehouse is a
stock location *belonging to* a Company — so that line could be read two ways.

**The repository settles it.** `Store` carries only `erpnextWarehouseId`; there is no
`erpnextCompanyId` on Store. And DOMAIN_MODEL.md defines Tenant as *"the business/company
shell"*. Therefore: **one Company per Tenant, many Warehouses per Company, one Warehouse per
Store.** This is derived from existing evidence, not chosen for convenience.

**Multi-store (deliverable 9):** additional stores become additional Warehouses inside the
*same* Company and the *same* site. A tenant does not get a second site for a second store.
Only a genuinely separate legal entity would justify a second Company, and that is a
Phase-15 question, not a Phase-2 one.

---

## 4. Data ownership

The authoritative ownership matrix already exists as **DATA_OWNERSHIP_MATRIX.md** and is not
duplicated here — one source of truth per fact. That document now carries the physical
database for each domain.

The four rules it encodes, restated because they are the boundary:

1. **Never store in AMBURAX PostgreSQL:** any stock quantity, account balance, receivable,
   payable, tax computation or invoice number treated as true. Currently satisfied — no such
   column exists in `schema.prisma` [BUILT].
2. **Never store in ERPNext MariaDB:** AMBURAX authentication credentials, session tokens,
   MFA challenges, password hashes, invitation tokens, POS pairing codes or device secrets.
   ERPNext must never become an identity provider for AMBURAX.
3. **May be cached / read-modelled in AMBURAX:** item, variant, barcode, price list, tax
   metadata, customer lookup subsets, last-known stock. All **explicitly non-authoritative**,
   all rebuildable, all labelled as estimates in the UI where staleness can mislead
   (OFFLINE_POS.md section 14's "Local estimate — server confirmation pending" rule).
4. **Cross-system links are mapping keys, never copies** — `erpnextSiteId`,
   `erpnextWarehouseId`, and a future `erpnextCompanyId`. Null until a real adapter fills them.

---

## 5. Synchronization matrix

**[TARGET]** — nothing in this table is implemented.

| Flow | Direction | Trigger | Mechanism | Idempotency key |
|---|---|---|---|---|
| Site + Company provisioning | AMBURAX -> ERPNext | Tenant reaches OWNER_CREATED | Outbox event -> adapter | `tenant:TenantProvisionRequested:<tenantId>` |
| Warehouse provisioning | AMBURAX -> ERPNext | Store created (A7) | Outbox event -> adapter | `tenant:StoreProvisionRequested:<storeId>` |
| POS sale posting | AMBURAX -> ERPNext | Sale committed | **See §14-B — open** | `tenant:store:device:localTxnId` |
| Payment posting | AMBURAX -> ERPNext | Payment confirmed | With its invoice | same as sale |
| Stock read | ERPNext -> AMBURAX | On demand / scheduled | Adapter read model | n/a (read) |
| Catalog read | ERPNext -> AMBURAX | Scheduled + on change | Adapter read model | n/a (read) |
| Channel order -> invoice | AMBURAX -> ERPNext | Canonical order confirmed | Outbox event | `tenant:channel:externalOrderId` |
| Reconciliation sweep | ERPNext -> AMBURAX | Scheduled | Adapter read + compare | n/a (read) |

**Direction rule:** AMBURAX writes to ERPNext through the adapter; ERPNext never writes to
AMBURAX. ERPNext has no credentials for PostgreSQL and no callback into AMBURAX's database.
Anything ERPNext "tells" AMBURAX is a **read** the adapter performs.

---

## 6. Failure, retry and reconciliation

**ERPNext unavailable — required behaviour:**

| Operation | Behaviour when ERPNext is down |
|---|---|
| Sign in, onboarding, team, POS pairing | **Unaffected.** These are pure AMBURAX domains. |
| Reading cached catalog/price | Serves last known value, **labelled stale**. |
| Sale posting | **Must not be reported as complete.** Queued, state `SERVER_ACCEPTED`, never `ERP_VERIFIED`. |
| Stock quantity | **Never presented as confirmed.** Local estimate only. |
| Any financial report | Unavailable, not approximated. |

ARCHITECTURE.md's rule is binding: *"ERPNext outage must fail critical writes safely."*
DISASTER_RECOVERY.md's is too: *"A timeout must never be treated as a successful sale."*

**Retry:** the existing outbox already provides it **[BUILT]** — exponential backoff 30 s to
1 h cap, dead-letter after 8 attempts, `FOR UPDATE SKIP LOCKED` claiming, `lastError`
scrubbed through the P0-2 sanitiser. **No new retry system is to be invented** (ADR-072).

**Reconciliation:** a scheduled sweep compares AMBURAX-side intent against ERPNext-side
record and raises a reconciliation case for a human. Never auto-resolves a financial
mismatch (OFFLINE_POS.md section 22).

**Dead letters are an operational alarm, not a bin.** A dead-lettered sale means a real
transaction the ledger does not know about.

---

## 7. Provisioning lifecycle

**[TARGET]** — contract only; nothing implemented.

```text
A5 Tenant created  -- outbox --> provision site      --> Tenant.erpnextSiteId
A6 Owner created   -- outbox --> provision Company   --> (new column, §14-A)
A7 Store created   -- outbox --> provision Warehouse --> Store.erpnextWarehouseId
```

**Rules, all already established:**

- **Asynchronous, never inline.** ERPNEXT_DOCTYPE_MAP.md's provisioning contract is explicit:
  called after the business transaction commits, never in the request/response cycle.
- **Enqueued in the same transaction** as the mutation that triggers it — that is exactly what
  the outbox is for (ADR-070).
- **`NOT_PROVISIONED -> PROVISIONING -> PROVISIONED | FAILED`** is modelled honestly. `FAILED`
  is surfaced operationally, **never retried forever and never shown to the merchant as
  success** (ADR-038).
- **Onboarding does not block on it.** A10 already reports inventory as `UNAVAILABLE` while
  provisioning is incomplete [BUILT], which is the correct and honest behaviour.

---

## 8. Upgrade lifecycle

1. Pin an exact ERPNext **and** Frappe version per environment; record in ERPNext_VERSION_PIN.md.
2. **Contract-test the adapter against the candidate version before upgrading** — the adapter
   is the only surface that can break, which is the point of confining ERPNext knowledge to it.
3. Upgrade a canary site first (Tier 1 sites are individually upgradable — a genuine
   advantage of site-per-tenant over shared-schema).
4. Tier 2/3 tenants may pin a different version for a bounded window; the adapter must
   declare which versions it supports rather than assume one.
5. **Never upgrade because a new version exists.** Upgrade for a security fix, a required
   capability, or an EOL deadline.

---

## 9. Security boundary

- **No client ever talks to ERPNext.** ADR-002. The browser has no ERPNext URL, credential
  or session. Verified today: zero ERPNext references in any client component [BUILT].
- **ERPNext credentials are server-side, per-tenant, and vaulted.** Never in `NEXT_PUBLIC_*`,
  never in a client bundle, never in an outbox payload, never in a log. TENANT_ROUTING.md
  already lists "ERPNext credentials and site routing" as mandatorily tenant-scoped.
- **One credential per site.** A single shared super-user across all tenants' sites would
  make one compromised credential a cross-tenant breach.
- **Adapter errors go through `sanitizeText`** before logging or persisting — ERPNext errors
  can embed URLs and tokens exactly as Prisma errors can embed connection strings (P0-2).
- **Tenant isolation is enforced at both layers:** AMBURAX by tenant-scoped queries
  [BUILT, proven by integration tests]; ERPNext by *physical database separation per site* —
  a stronger guarantee than AMBURAX's application-level scoping, because there is no shared
  table to leak across.

---

## 10. Licensing boundary

Reconciled against `LICENSE_RECONCILIATION.md` (the real file; the two named in the brief do
not exist).

| Component | License | Location |
|---|---|---|
| AMBURAX app + adapter | Proprietary | `apps/web/**` |
| ERPNext | **GPLv3** | separate deployment [FUTURE] |
| Frappe Framework | MIT | same |
| `amburax_erp` customization app | GPLv3-compatible, **separate repository/app** | [FUTURE] |

**Rules:**

1. No ERPNext source or frontend asset is ever copied into the proprietary tree. Verified
   today: zero matches [BUILT].
2. Any ERPNext *customization* (custom DocType, hook, fixture, server script) lives in a
   separate `amburax_erp` Frappe app, **never** in `apps/web`.
3. The adapter communicates over ERPNext's **network API**. It does not import Frappe
   modules, subclass Frappe classes, or link ERPNext code.

> **This is an engineering boundary, not a legal conclusion.** Whether an API boundary
> avoids creating a derivative work is a question of law and jurisdiction, not of
> architecture. The SaaS-first model means GPLv3's distribution trigger may not fire at all —
> but that is also a legal determination. **Both require counsel before commercial launch,
> and certainly before any self-hosted distribution.** Nothing here is a legal opinion, and
> the architecture must not be cited as though it settled the question.

---

## 11. Scaling model

**[TARGET] — 100k+ tenants is a design target. It is not implemented and has never been
benchmarked.** SCALABILITY.md says exactly this and it remains true.

| Tier | Who | ERPNext | MariaDB | Promotion trigger |
|---|---|---|---|---|
| **1 — Shared** | Small merchants (default) | Shared bench, own site | Shared server, own DB | default on signup |
| **2 — Dedicated** | High-volume / multi-store | Own bench | Own instance | transaction volume, noisy-neighbour impact, SLA |
| **3 — Isolated** | Enterprise / regulated | Own bench, own infra | Own instance, own host/VPC/region | contractual, residency, compliance |

**Scaling levers, in the order DATABASE_STRATEGY.md already prescribes:** PostgreSQL -> read
models/replicas -> proven partitioning -> search/analytics stores -> tenant-tier isolation.

**Known bottleneck, stated plainly:** at 100k tenants, Tier 1 implies roughly 100k Frappe
sites and 100k MariaDB databases. Frappe is not known to have been operated at that density
in a single bench, and **we have not tested it.** The realistic shape is many benches of
bounded size (a shard of sites per bench), with `Tenant.erpnextSiteId` plus a bench/host
mapping as the routing key. **That number must be established by load testing before any
capacity claim is made** (CAPACITY_TESTING.md).

---

## 12. Rejected alternatives

### A — One ERPNext site per tenant, always dedicated infrastructure — REJECTED
Strongest isolation, and the correct model at Tier 3. Rejected as a *universal* policy on
cost and operations: a bench and MariaDB instance per merchant is untenable for a small shop,
and at 100k tenants means 100k benches to patch, back up and upgrade. It optimises for the
rarest customer at the expense of the most common one.

### B — Shared ERPNext infrastructure with multiple isolated sites — REJECTED as universal
The right default (it *is* Tier 1) but wrong as the only option. It has no answer for a
tenant with data-residency obligations, a contractual isolation requirement, or volume that
makes them a noisy neighbour. Adopting it alone would force a re-architecture the first time
an enterprise customer signs.

### C — Single shared ERPNext site, tenant column on every DocType — REJECTED OUTRIGHT
Cheapest to run and catastrophic to own. It would mean one MariaDB holding every tenant's
ledger, with isolation resting on application-level filtering of ERPNext's own queries —
code we do not control. One missing filter is a cross-tenant financial data breach. It also
fights ERPNext's design (Company/Warehouse assume single-tenant), makes per-tenant restore
effectively impossible, and forces all tenants onto one upgrade schedule.

### D — Replace ERPNext; build accounting and stock in PostgreSQL — REJECTED
Removes the two-database problem entirely. Rejected because it contradicts the project's
founding constraint — *"AMBURAX DOES NOT REBUILD ERPNEXT"* (ADR-001, ERPNEXT_COVERAGE.md) —
and because building a correct double-entry ledger, tax engine and stock valuation is years
of work with severe correctness and compliance risk. Recorded so the option is visibly
considered and closed, not silently ignored.

### E — Single shared MariaDB server, one database per site — PARTIALLY ACCEPTED
This *is* Tier 1's storage layout and is accepted there. Rejected as a universal policy for
the same reason as B: it cannot satisfy residency or dedicated-capacity requirements.

---

## 13. Consistency model

**Settled from evidence:** ERPNext is authoritative for the financial record — the Sales
Invoice, Payment Entry, GL impact and stock movement (ADR-001, ERPNEXT_COVERAGE.md,
DATA_STRATEGY.md). AMBURAX never holds a competing authoritative copy.

**Consistency is eventual, and the UI must say so.** There is no distributed transaction
between PostgreSQL and MariaDB, and we will not attempt one. The pattern is the one
ARCHITECTURE.md already states: *authoritative commit -> durable outbox -> event ->
idempotent consumers -> retry -> reconciliation.*

**The state vocabulary already exists** in OFFLINE_POS.md section 16 and applies to online
sales too: `SERVER_ACCEPTED` (AMBURAX has it) is **not** `ERP_VERIFIED` (ERPNext posted it)
is **not** `COMPLETED`. A receipt must not claim ERP completion at `SERVER_ACCEPTED`.

**Idempotency:** `tenant + store + device + local_transaction_id` (OFFLINE_POS.md section 8)
is the key for sale posting, carried as the outbox `idempotencyKey`. The same command
reaching ERPNext twice must create exactly one invoice. **Delivery is at-least-once and the
publisher is a disclosed stand-in — no message broker exists** (ADR-071, ADR-073).

---

## 14. Assumptions and unresolved questions

### RESOLVED from repository evidence
- Tenant -> site, Store -> Warehouse: settled by existing schema columns.
- Tenant -> Company: settled by DOMAIN_MODEL.md's definition of Tenant plus the absence of any
  Company column on Store.
- ERPNext authoritative for financial records: ADR-001 + ERPNEXT_COVERAGE.md.
- Tiering is intended: DATABASE_STRATEGY.md and SCALABILITY.md both name "tenant-tier isolation".

### OPEN — A. No `Tenant.erpnextCompanyId` column exists
The mapping is decided; the column to record it is not present. **Do not add it now** — it
belongs in the first Phase-2 migration, alongside the adapter that will populate it. Adding a
column nothing writes repeats the orphan-code mistake of P1-5.

### OPEN — B. Online POS sale synchrony — PRODUCT DECISION REQUIRED
The documents genuinely disagree, and this is **not** resolvable from repository evidence:

- FLOWS.md: `Payment -> Validate -> ERPNext -> Success -> Receipt` — reads synchronous.
- ARCHITECTURE.md lists "final sale, payment confirmation" under **Synchronous**.
- OFFLINE_POS.md section 16 defines `SERVER_ACCEPTED` and `ERP_VERIFIED` as **distinct
  states**, and section 27 says the final state is not accepted until authoritative
  verification — reads asynchronous.

Ownership is settled either way (ERPNext owns the invoice). What is unsettled is **whether
the cashier waits for ERPNext before the receipt prints.** Synchronous gives an unambiguous
receipt but makes every sale fail when ERPNext is slow or down; asynchronous keeps the till
running but requires provisional receipts and a reconciliation surface.

**This must be answered before Phase 3.** It is not blocking Phase 2 (the adapter, reads and
provisioning are unaffected). **No choice has been made here** — the instruction to stop
rather than silently decide applies precisely to this question.

### OPEN — C. ERPNext hosting shape
Managed (Frappe Cloud) vs self-hosted bench vs containers is undecided and materially changes
§7, §8, §11 and §12's cost model. Requires a commercial decision, not an architectural one.

### OPEN — D. Backup and restore across two databases
A tenant's state spans PostgreSQL and MariaDB. A restore that rewinds one and not the other
produces invoices with no session/device provenance, or devices referencing invoices that no
longer exist. **Required:** per-tenant coordinated restore with a documented ordering, and a
tested restore — DISASTER_RECOVERY.md's own rule is that *"a backup is not proven until
restore has been tested."* Today there is **no backup of anything** (DATABASE_SETUP.md §9).

### ASSUMPTIONS (stated so they can be falsified)
1. Frappe's site-per-tenant model gives per-site MariaDB databases and credentials. **Not
   verified in this environment** — no Frappe is installed.
2. ERPNext exposes a network API sufficient for the §5 operations without modifying core.
3. One Company per tenant suffices; multi-legal-entity tenants are a Phase-15 concern.
4. Frappe site density per bench is bounded and must be measured, not assumed.

---

## 15. What this decision does NOT authorise

Implementing ERPNext. This document settles the boundary so that Phase 2 *can* begin
correctly; it is not itself permission to start. Phase 2 additionally requires: the §14-C
hosting decision, an `ERPNext_VERSION_PIN.md` with a real recorded version, and legal review
of §10.
