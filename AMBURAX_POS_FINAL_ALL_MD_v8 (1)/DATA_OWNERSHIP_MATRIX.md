# AMBURAX POS — DATA OWNERSHIP MATRIX

Audit date: 2026-09-11

Classification vocabulary:

| Class | Meaning |
|---|---|
| **AMBURAX MASTER** | AMBURAX holds the authoritative record. ERPNext either does not know about it or holds a derived copy. |
| **ERPNEXT MASTER** | ERPNext holds the authoritative record. AMBURAX must never keep a competing authoritative copy. |
| **SHARED-ORCHESTRATED** | Both systems hold part of the truth. AMBURAX owns experience/policy/mapping; ERPNext owns the financial or stock consequence. Requires an explicit mapping and reconciliation. |
| **READ MODEL** | A denormalized, non-authoritative projection kept for query speed or offline use. Never written back from, never used to settle a dispute. |

A fourth state is used where honesty demands it:

| **NOT IMPLEMENTED** | The domain has no storage anywhere in the system today. |

---

## 1. Domains with real storage today (12 Prisma models)

| Domain | Model(s) | Class | Notes |
|---|---|---|---|
| Tenant / business identity | `Tenant` | **AMBURAX MASTER** | Slug, business type, onboarding progress. ERPNext will hold a Company, mapped by `erpnextSiteId` — currently null. |
| Onboarding progress | `Tenant.onboardingStep`, `OnboardingSession` | **AMBURAX MASTER** | Purely an AMBURAX product concept. ERPNext has no equivalent and must never be consulted for it. |
| User / login identity | `User` | **AMBURAX MASTER** | Email, password hash, `tenantRole`, MFA flag, lockout. **Deliberately not an ERPNext User.** If ERPNext users are ever provisioned they are a downstream projection, not the master. |
| Session | `Session` | **AMBURAX MASTER** | Opaque hashed DB-backed tokens (ADR-022) so A14 can revoke individually. |
| Authentication credentials | `MfaChallenge`, `PasswordResetToken` | **AMBURAX MASTER** | Five distinct credential models sharing only hash helpers. Never shared with ERPNext. |
| Store / location | `Store` | **SHARED-ORCHESTRATED** | AMBURAX masters the *store* concept (name, code, timezone, policy, terminal context). ERPNext will master the **Warehouse** it maps to, via `erpnextWarehouseId` — currently null, `NOT_PROVISIONED`. AMBURAX must never hold stock quantities on this row. |
| Store membership / access | `StoreMembership` | **AMBURAX MASTER** | Who may operate where, and in what role. Authorization is an AMBURAX concern end to end. |
| Staff invitations | `Invitation` | **AMBURAX MASTER** | Pre-account credential. No ERPNext counterpart. |
| POS terminal | `PosDevice` | **AMBURAX MASTER** | Explicitly *not* an ERPNext document — ERPNEXT_DOCTYPE_MAP.md records `(none)` for it (ADR-064). What ERPNext will own is the invoices the till posts, never the till. |
| Rate-limit / attempt log | `LoginAttempt` | **AMBURAX MASTER** | Durable per-IP/per-context limiter and audit source. |
| Audit log | `AuditLog` | **AMBURAX MASTER** | AMBURAX's own action trail. Distinct from ERPNext's version/comment trail, which will remain ERPNext's. |

## 2. Domains that are ERPNEXT MASTER by design — and have no storage yet

None of the following exist anywhere in the codebase. They are recorded here so
that the first line of code written for each lands on the correct side of the
boundary.

| Domain | Class | Current state |
|---|---|---|
| Stock ledger / stock entries | **ERPNEXT MASTER** | **NOT IMPLEMENTED** |
| Stock reconciliation | **ERPNEXT MASTER** | **NOT IMPLEMENTED** |
| Sales Invoice | **ERPNEXT MASTER** | **NOT IMPLEMENTED** |
| Payment Entry | **ERPNEXT MASTER** | **NOT IMPLEMENTED** |
| Receivables / payables | **ERPNEXT MASTER** | **NOT IMPLEMENTED** |
| Accounting / GL | **ERPNEXT MASTER** | **NOT IMPLEMENTED** |
| Tax / GST framework | **ERPNEXT MASTER** | **NOT IMPLEMENTED** |
| Purchase orders / receipts / invoices | **ERPNEXT MASTER** | **NOT IMPLEMENTED** |
| Suppliers | **ERPNEXT MASTER** | **NOT IMPLEMENTED** |
| Invoice numbering series | **ERPNEXT MASTER** | **NOT IMPLEMENTED** — A9 deliberately refused to collect an invoice prefix/start number for exactly this reason (ADR-063). |
| Warehouse | **ERPNEXT MASTER** | **NOT IMPLEMENTED** — `Store.erpnextWarehouseId` is the reserved mapping key. |

## 3. Domains that will be SHARED-ORCHESTRATED — none implemented

| Domain | AMBURAX owns | ERPNext owns | State |
|---|---|---|---|
| Sale / checkout | Cart UX, discount policy, device/shift attribution, idempotency key | Sales Invoice, Payment Entry, GL impact | **NOT IMPLEMENTED** |
| Pricing / promotions | Promotion rules, display price, campaign logic | Price List, final taxable amount | **NOT IMPLEMENTED** |
| Returns / exchanges | Eligibility UX and policy | Credit Note, stock and accounting reversal | **NOT IMPLEMENTED** |
| Customer | Customer 360 experience, segmentation, Khata UX | Customer record, receivable balance | **NOT IMPLEMENTED** |
| Shifts / cash register | Shift lifecycle, cash counts, staff attribution | Journal/Payment entries arising | **NOT IMPLEMENTED** |
| Product / variant catalog | Canonical product & variant identity (ADR-005), garment attributes | Item, Item Variant, valuation | **NOT IMPLEMENTED** |
| Channel / marketplace | Channel accounts, capabilities, schemas, external ID mapping, allocation policy (ADR-009) | Resulting invoices and stock movement | **NOT IMPLEMENTED** |

## 4. READ MODEL — none implemented

No projection, cache, search index or offline replica exists.

The offline POS cache described in OFFLINE_POS.md §5 (product master, price, tax
metadata, cached stock, customer subset) is the first planned READ MODEL. It is
**NOT IMPLEMENTED**, and when built it must be labelled non-authoritative in the
UI — OFFLINE_POS.md §14's "Local estimate — server confirmation pending" rule.

## 5. Standing rules this matrix enforces

1. **No duplicate authoritative ledger.** AMBURAX must never store a stock
   quantity, account balance, receivable, or tax computation it treats as true.
   Currently satisfied: no such column exists in `schema.prisma`.
2. **Identity is AMBURAX's, always.** `User`, `Session`, `StoreMembership` and the
   credential models are never delegated to ERPNext, and ERPNext's user table is
   never an authentication source for AMBURAX.
3. **Mapping keys, not copies.** Cross-system links are carried as explicit id
   columns (`erpnextSiteId`, `erpnextWarehouseId`) that are null until a real
   adapter fills them — never as duplicated business data.
4. **Placeholder is not integration.** Every ERPNext column currently reads
   `NOT_PROVISIONED`. No screen may report an ERPNext-mastered domain as ready
   while that is true. A10 already enforces this by reporting `inventory` as
   `UNAVAILABLE`.

## 6. Open ownership question requiring a decision

**AMBURAX runs PostgreSQL; Frappe/ERPNext requires MariaDB.** That makes the
target a two-database system, and no document currently states:

- whether they share a host,
- how a cross-database transaction failure is reconciled,
- which system is consulted first during a POS sale,
- what the backup/restore ordering is between them.

This is recorded as **P1-7** in ARCHITECTURE_GAPS.md and must be settled before
the first ERPNext write path is designed.
