# AMBURAX — MASTER DEVELOPMENT PLAN
## Backend + New Frontend Rebuild
**Status:** Authoritative project execution plan

## 1. NON-NEGOTIABLE DECISION

The existing/demo POS frontend is obsolete.

We are starting a **new frontend from scratch**.

Old demo frontend:
- Do not treat it as the product foundation.
- Do not continue polishing/redesigning it.
- Do not preserve its UX for compatibility.
- It may be archived/removed only through an explicit scoped task.
- Do not damage existing backend work while removing it.

New frontend:
- Must be designed around the final AMBURAX business model.
- Must consume stable backend/API contracts.
- Must not redefine backend business rules.

## 2. WHAT AMBURAX IS

AMBURAX is a **capability-based, multi-tenant Business Operating Platform**, not merely a POS.

Core capabilities:
- Retail / POS
- Wholesale / B2B
- Manufacturing
- Job Work / Subcontracting
- Procurement
- Inventory / WIP
- CRM / Customers
- Finance / ERP
- Quality
- Logistics / Fulfillment
- Commerce / Marketplaces
- AI / Automation

Future-capable:
- Distribution
- Franchise
- Field Sales
- Service / Repair
- Projects / Contracts
- Rental / Subscription
- Industry-specific extensions

One tenant may enable any combination of capabilities. Do not create separate retail/wholesale/manufacturing product, customer, or inventory systems.

## 3. THREE-PLANE ARCHITECTURE

### Control Plane
Tenant, identity, users, RBAC, capabilities, billing, feature flags, placement, provisioning, resource limits.

### Data Plane
Retail, wholesale, manufacturing, job work, procurement, inventory, CRM, logistics, commerce, APIs, workers.

### Intelligence Plane
AI gateway, context/retrieval, recommendations, predictions, automation, policy/guardrails, evaluation.

## 4. ERPNEXT ARCHITECTURE

**AMBURAX does not rebuild ERPNext. AMBURAX orchestrates ERPNext.**

Flow:

```text
AMBURAX Domain
      |
ERPNext Adapter
      |
ERPNext API
      |
ERPNext Site
      |
MariaDB
```

Only the ERPNext Adapter may know ERPNext API/site/credential/version/ID/retry details.

AMBURAX PostgreSQL owns:
- tenant
- users/sessions
- RBAC
- stores/devices
- capabilities
- commerce mappings/external IDs
- sync state
- outbox
- AI/automation
- operational read models
- B2B pipeline

ERPNext/MariaDB remains authoritative for:
- accounting/GL
- GST/tax accounting
- ERP stock ledger where applicable
- ERP warehouses/items
- ERP customers/suppliers
- invoices/payments
- BOM
- production/work orders
- manufacturing accounting

No uncontrolled dual authority.

Default mapping:

```text
1 AMBURAX Tenant = 1 ERPNext Site = 1 ERPNext Database
```

ERP infrastructure may be pooled; large tenants may receive dedicated resources/cells. Do not put all tenants in one ERP site and do not deploy a full ERP cluster per tiny tenant.

## 5. EVENT / OUTBOX

Business transaction + outbox event must be atomic.

Envelope:
- event_id
- event_type
- event_version
- occurred_at
- tenant_id
- store_id
- actor
- correlation_id
- causation_id
- entity_id
- payload

Semantics:
- at-least-once
- idempotent consumers
- never claim exactly-once

Current outbox runner is a foundation/stand-in. A production broker such as Kafka/Redpanda comes later when justified.

## 6. AI SECURITY

AI must never have unrestricted SQL/database/ERPNext/filesystem access.

Required path:

```text
User/Event
   |
AI Gateway
   |
Context/Retrieval
   |
Typed Tool
   |
Permission Check
   |
Policy/Guardrail
   |
Domain Service
   |
Transaction
```

Low-risk may automate; medium-risk may require policy/approval; high-risk requires approval.

AI comes after reliable domain foundations.

## 7. CURRENT BACKEND STATUS

### P1-8A — CI: GREEN / DONE
npm is canonical, lockfile and deterministic gates established.

### P1-8B — Inventory Movement Foundation: GREEN / DONE
Authoritative StockMovement ledger and StockLevel projection exist.
Movement types include:
- OPENING_BALANCE
- RECEIPT
- SALE
- ADJUSTMENT
- STOCK_TAKE

This is a foundation, not a complete inventory system.

### P1-8C — UOM Foundation: GREEN / DONE
Integer-safe UOM/conversion foundation exists.
Examples:
- PCS
- DOZEN
- PACK
- CARTON

Decimal quantities are intentionally deferred.

### P1-8D — Address Foundation: GREEN / DONE
Tenant-owned addresses, customer address joins, billing/shipping/both, defaults, and GSTIN shape validation exist.

## 8. IMMEDIATE BACKEND SEQUENCE

### P1-8E — PRICING FOUNDATION
**Current phase.**

Expected:
- PriceList
- PriceListItem
- Customer.priceListId
- Store.priceListId if needed

Resolution:

```text
Customer Price List
        |
Store Price List
        |
Tenant Default Price List
        |
Variant Base Price
```

Quantity breaks select the highest applicable minQuantity <= requested quantity.

Requirements:
- integer minor-unit money
- UOM-aware pricing
- validity windows
- tenant isolation
- duplicate prevention
- server-authoritative pricing

Explicitly exclude:
- promotions
- coupons
- schemes
- free quantity
- loyalty
- approval limits
- full discount engine
- FX engine
- tax engine

### P1-8F — CAPABILITY MODEL
Tenant capabilities such as:
- RETAIL
- WHOLESALE
- MANUFACTURING
- JOB_WORK
- COMMERCE
- PROCUREMENT
- DISTRIBUTION

Backend must enforce capability gates. Hiding frontend buttons is not authorization.

### P1-8G — ORDER FOUNDATION

Lifecycle:

```text
DRAFT
  |
CONFIRMED
  |
RESERVED
  |
PARTIALLY_FULFILLED
  |
FULFILLED
  |
CLOSED
```

Cancellation must be modeled appropriately. Payment state and fulfillment state remain separate axes.

Order eventually supports customer, items, UOM, pricing, quantity, fulfillment, reservation, address snapshot, tenant isolation, and idempotency.

### P1-8H — TENANT DATABASE INVARIANTS

Harden structural tenant isolation across:
- sales
- sale items
- stock levels
- POS devices
- invitations
- product variants
- sessions
- MFA
- password reset
- related tenant-scoped entities

### P1-8 FINAL GATE

Do not begin major domain expansion until P1-8 is green.

Required:
- migration correctness
- tenant isolation
- transaction correctness
- authorization
- concurrency checks
- tests/integration tests
- build
- lint
- typecheck
- migration drift
- fresh DB
- Git diff review
- scope review

## 9. ERPNext ADAPTER

After P1-8:
- connection abstraction
- tenant/site routing
- authentication
- credentials
- versioned contracts
- ID mapping
- retries/timeouts
- error translation
- idempotency
- observability

No domain service directly depends on ERPNext implementation details.

## 10. RETAIL / POS

Build a real POS using the new backend contracts:
- catalogue
- product/variant
- barcode
- pricing
- UOM
- customer
- cart
- sale
- payment
- returns
- exchanges
- receipts
- cashier
- shift
- store
- POS device
- inventory integration

## 11. PROCUREMENT

```text
Purchase Request
      |
Purchase Order
      |
Goods Receipt / GRN
      |
Stock Receipt
      |
Purchase Invoice
      |
Payment
```

Supplier foundation includes supplier, contacts, GST, addresses, payment terms, credit.

## 12. WHOLESALE / B2B

Support:
- B2B customers
- dealer/distributor profiles
- GST
- credit limits
- payment terms
- customer price lists
- MOQ
- quantity pricing
- multiple addresses
- sales reps/territories later

Flow:

```text
Quotation
   |
Sales Order
   |
Credit Check
   |
Reservation
   |
Pick
   |
Pack
   |
Dispatch
   |
Invoice
   |
Payment
```

Eventually support partial fulfillment, multiple shipments, outstanding, collections, ageing.

## 13. MANUFACTURING

```text
Design / Style
      |
Product
      |
BOM
      |
Material Requirement
      |
Procurement
      |
Production Order
      |
Material Issue
      |
WIP
      |
Production
      |
QC
      |
Finished Goods
```

Garment requirements:
- fabric/trims/buttons/thread/labels/packaging
- BOM versions
- operations/workstations
- wastage/yield
- labour
- production costing
- QC/rejection/rework

## 14. JOB WORK

Support:
- job worker
- material issue/receipt
- consumption
- wastage
- rejection
- output
- job-work charges
- pending material
- reconciliation
- stage tracking

Explicitly distinguish:
- company-owned material
- customer-owned material
- material physically held by job worker

## 15. ADVANCED INVENTORY

Later:
- warehouses
- locations/bins
- transfers
- reservations
- availability
- batch/lot
- serial numbers where applicable
- WIP/transit/rejected stock
- reconciliation
- valuation/costing
- negative-stock policy

## 16. LOGISTICS / FULFILLMENT

Later:
- picking
- packing
- shipment
- courier integration
- AWB
- tracking
- delivery
- RTO
- returns
- reverse logistics
- labels/manifests

## 17. COMMERCE / MARKETPLACES

Initial:
- Amazon
- Flipkart
- Meesho
- Shopify
- WooCommerce
- ONDC
- IndiaMART

Later:
- Myntra
- AJIO
- Nykaa
- others

Use a Commerce Gateway. Each channel needs authentication, mapping, inventory/price sync, order import, fulfillment, cancellation, returns, webhooks, retries, idempotency, settlement/reconciliation.

## 18. CRM / KHATA / COLLECTIONS

CRM:
- leads
- prospects
- customers
- interactions
- sales reps
- follow-ups

B2B operations:
- invoices
- outstanding
- ageing
- payments
- credit
- collection history
- reminders

ERPNext remains accounting authority.

## 19. OFFLINE POS

Only after online transaction semantics are stable.

```text
POS Device
   |
Encrypted Local Store
   |
Durable Queue
   |
Offline Transactions
   |
Reconnect
   |
Sync Engine
   |
Server
```

Need device identity, local sequence, idempotency, ordered replay, conflict handling, reconciliation, stale stock indication, payment safety.

Do not promise the entire ERP offline.

## 20. NEW FRONTEND — FROM SCRATCH

The old demo POS is **not the base**.

The new frontend is a first-class project stream, built against stable AMBURAX contracts.

Principles:
- desktop-first business application
- premium professional UI
- fast POS workflows
- keyboard/barcode friendly
- capability-aware navigation
- tenant/store context
- permission-aware actions
- realtime where justified
- PWA capability for POS
- offline support later
- accessibility
- consistent design system

First surfaces:
1. application shell
2. authentication
3. tenant/store context
4. navigation
5. dashboard framework
6. product/catalogue
7. customer
8. pricing
9. POS shell
10. order workflows

Then:
- procurement
- wholesale
- manufacturing
- job work
- inventory
- commerce
- logistics
- CRM
- analytics
- AI

Frontend must never become the source of truth for business rules, totals, permissions, or ERP access.

## 21. FRONTEND/BACKEND WORKING MODEL

We are **backend-first, not backend-only**.

Backend is the source of truth.

Frontend can proceed in parallel when the corresponding backend contract is stable.

Correct loop:

```text
Backend contract
      |
API/schema stable
      |
Frontend implementation
      |
Integration
      |
Browser verification
      |
Regression
```

Do not repeatedly bounce between unstable backend and frontend.

The old frontend can be removed/archived in a dedicated cleanup task, but that cleanup must not destroy backend work.

## 22. EVENT INFRASTRUCTURE

Later:
- production broker
- consumers
- retry
- dead-letter
- replay
- event observability
- idempotency

Do not introduce distributed infrastructure merely because it sounds scalable.

## 23. ANALYTICS / BI

Eventually:

```text
Operational Systems
      |
Events
      |
Analytics Pipeline
      |
Warehouse
      |
BI
```

Metrics include sales, margin, inventory, purchasing, production, job work, marketplace profitability, customer profitability, branch/store and salesperson performance.

## 24. AI

Only after stable domain services, permissions, typed tools, auditability, and reliable data.

Potential:
- sales assistant
- inventory assistant
- purchase suggestions
- demand forecasting
- customer intelligence
- B2B collection prioritization
- production planning
- job-work delay prediction
- marketplace anomaly detection
- automation

## 25. SECURITY HARDENING

Dedicated phase:
- sessions
- MFA
- password policies
- session revocation
- device trust
- tenant/store/warehouse/capability/role/permission authorization
- approval limits
- rate limiting
- secure cookies
- secrets
- encryption
- webhook validation
- replay protection
- idempotency
- audit
- abuse protection

## 26. SCALE / CELL ARCHITECTURE

Target:

```text
Region
  |
Cells
  |
Tenant Placement
  |
PostgreSQL
  |
ERP Placement
```

Must benchmark before freezing:
- tenants/cell
- DB connections
- TPS
- event throughput
- worker throughput
- ERP throughput
- commerce sync
- realtime connections
- backup/restore duration
- RPO/RTO

100k+ is a target, not a proven current capacity.

## 27. OBSERVABILITY / SRE

Need:
- structured logs
- metrics
- traces
- correlation IDs
- error tracking
- queue/dead-letter monitoring
- DB monitoring
- ERP health
- commerce health
- alerting
- uptime
- backup verification

## 28. DISASTER RECOVERY

Must prove:
- backup/restore
- tenant recovery
- cell recovery
- ERP recovery
- event recovery
- duplicate-event handling
- partial-failure recovery
- deployment rollback

## 29. PERFORMANCE / LOAD TESTING

Eventually test:
- POS concurrency
- checkout TPS
- inventory concurrency
- wholesale orders/reservations
- manufacturing workloads
- commerce webhook spikes
- worker throughput

Scale testing:
- 1k tenants
- 10k
- 50k
- 100k+ simulation

## 30. COMPLIANCE / OSS / LEGAL

Before serious commercial launch:
- applicable Indian privacy/data obligations
- GST requirements
- audit requirements
- retention/deletion
- OSS inventory
- SBOM
- license notices
- ERPNext/Frappe separation
- commercial agreements
- privacy policy
- terms
- enterprise requirements

Do not assume an API boundary automatically resolves all GPL/commercial licensing questions; obtain legal review.

## 31. MASTER ORDER

```text
P1-8E Pricing
  |
P1-8F Capability
  |
P1-8G Order
  |
P1-8H Tenant Invariants
  |
P1-8 FINAL GATE
  |
ERPNext Adapter
  |
Retail/POS Backend
  |
NEW FRONTEND CORE + POS
  |
Procurement
  |
Wholesale/B2B
  |
Manufacturing
  |
Job Work
  |
Advanced Inventory
  |
Logistics
  |
Commerce
  |
Offline POS
  |
Event Infrastructure
  |
CRM / Khata
  |
Analytics
  |
AI
  |
Security Hardening
  |
Scale/Cells
  |
Observability/SRE
  |
DR
  |
Load/Chaos Testing
  |
Compliance
  |
Production
```

## 32. PHASE EXECUTION RULE

Every phase:

1. Discovery
2. Design
3. Exact Claude implementation prompt
4. Implementation
5. Claude report
6. Independent audit
7. Evidence/tests
8. GREEN or RED
9. Fix RED
10. Only then continue

Passing tests alone does not equal GREEN.

## 33. DEFINITION OF GREEN

A phase is GREEN only when:
- scope is correct
- schema is correct
- tenant isolation is proven
- authorization is correct
- transactions are correct
- concurrency is considered
- fresh migration works
- migration drift is clean
- tests/integration tests pass
- typecheck/lint/build pass
- no unexplained `any`
- no ignored errors
- no hidden scope creep
- Git diff reviewed
- known risks documented
- unrelated frontend/backend areas are not damaged

## 34. BRUTAL TRUTH

Current reality:

| Area | Status |
|---|---|
| Architecture direction | Strong |
| Multi-tenancy foundation | Good |
| Inventory foundation | Good |
| UOM foundation | Good |
| Address foundation | Good |
| Pricing | NEXT |
| Orders | Not complete |
| Procurement | Not built |
| Wholesale | Not built |
| Manufacturing | Not built |
| Job Work | Not built |
| ERPNext Adapter | Not built |
| New Frontend | **RESTART FROM SCRATCH** |
| Offline POS | Not built |
| Commerce | Not built |
| AI | Not built |
| 100k scale | Not proven |
| DR | Not proven |
| Production readiness | **NO** |

The project is being built correctly, but it is still a foundation-stage system. Do not claim completion or production readiness prematurely.

## 35. ABSOLUTE AGENT RULES

1. Read this document before modifying AMBURAX.
2. Treat it as project-level direction.
3. Do not invent conflicting architecture.
4. Do not expand scope without explicit approval.
5. Do not modify unrelated areas.
6. Do not delete working backend foundations while replacing the demo frontend.
7. Never bypass tenant isolation.
8. Never use direct frontend -> ERPNext access.
9. Never use AI -> database/ERP direct access.
10. Never claim scale without measurements.
11. Never claim production readiness without gates.
12. Report RED when evidence is insufficient.
13. Prefer explicit failure over silent fallback.
14. Never hide failing tests.
15. Do not use destructive DB operations as a substitute for migrations.
16. Review Git diff before completion.
17. Keep commits scoped and descriptive.
18. Do not push unless explicitly instructed.
19. The old demo frontend is not the product foundation.
20. The new frontend must be built from the AMBURAX domain model.

## 36. IMMEDIATE ACTION

Current backend phase: **P1-8E Pricing Foundation**.

Finish P1-8E, audit it, and only if GREEN proceed to P1-8F.

In parallel, the frontend may begin **new-from-scratch discovery/design**, but it must consume stable backend contracts and must not redefine business rules.

## MASTER PRINCIPLE

> Correctness first.
> Domain model second.
> Security third.
> Scalability through measurement.
> UX on stable contracts.
> AI only after reliable foundations.
