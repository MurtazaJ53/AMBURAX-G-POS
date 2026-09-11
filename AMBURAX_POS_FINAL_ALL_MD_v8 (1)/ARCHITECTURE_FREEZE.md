# AMBURAX POS — ARCHITECTURE FREEZE

Status: **NOT FROZEN.**
Evaluated against the actual repository on **2026-09-11** (see REPO_AUDIT.md).

---

## Freeze principles (unchanged)

1. AMBURAX proprietary code and ERPNext customization remain physically/logically separate.
2. Frontend is independently implemented by AMBURAX.
3. ERPNext is an ERP engine, not the AMBURAX product layer.
4. ERPNext-specific customization belongs in a separate `amburax_erp` layer.
5. No ERPNext source/frontend copying.
6. ERPNext core modification is exceptional and requires documented justification.
7. No duplicate authoritative accounting or stock ledger.
8. Every request, job, cache, search index and object path must be tenant-scoped.
9. Every dependency must have a known license or be blocked.
10. API separation must not be described as a blanket GPL exemption.

Freeze only after repository, version, security, license, data, database and CI audits pass or have explicitly accepted blockers.

---

## Verdict: the architecture is NOT frozen

**9 blockers are open: 2 P0 and 7 P1.** See ARCHITECTURE_GAPS.md.

The most important reason is not any single defect. It is that **several principles
above are currently satisfied only vacuously** — they hold because the thing they
constrain does not exist yet. A principle that has never been tested has not been
proven, and freezing on that basis would record a conclusion the evidence does not
support.

### Principle-by-principle evidence

| # | Principle | Evidence | Verdict |
|---|---|---|---|
| 1 | Proprietary/ERPNext separation | No ERPNext code exists | **Vacuously true** — untested |
| 2 | Independent frontend | Next.js/React/Tailwind; zero ERPNext assets or copied source | **PROVEN** |
| 3 | ERPNext is the ERP engine | There is no ERP engine; no stock, accounting, tax or invoicing anywhere | **NOT YET TRUE** |
| 4 | `amburax_erp` layer | Does not exist | **Not yet applicable** |
| 5 | No ERPNext source copying | Verified by grep: no matches in any source file | **PROVEN** |
| 6 | No ERPNext core modification | No core present | **Vacuously true** |
| 7 | No duplicate authoritative ledger | No stock/balance/tax column exists in `schema.prisma`; A9 explicitly refused invoice numbering (ADR-063) | **PROVEN for current scope** |
| 8 | Tenant scoping everywhere | No route accepts client `tenantId`; `storeId` is authorization-checked; no client component touches the DB | **PROVEN for current scope** |
| 9 | Known license or blocked | 144 packages, 0 UNKNOWN, 0 GPL/AGPL | **PROVEN** |
| 10 | API separation is not a GPL exemption | Recorded in LICENSE_RECONCILIATION.md; no GPL code present to exempt | **Recorded, untested** |

Four principles are genuinely proven. Four are vacuously true. Two are not yet
true at all. That is a defensible *position*, but it is not a freeze.

### Gating conditions — all must be met

| Gate | Blocker | Status |
|---|---|---|
| Repository under version control | P0-1 | **FAILED** — no git repository exists |
| No credential leakage path | P0-2 | **FAILED** — raw Prisma errors can log `DATABASE_URL` |
| Database migrations exist | P1-1 | **FAILED** — no `prisma/migrations/` |
| Schema verified against a real database | P1-2 | **FAILED** — no PostgreSQL has ever run this code |
| No false product claims shipped | P1-3 | **FAILED** — login page advertises offline POS |
| Event/outbox foundation decided | P1-4 | **FAILED** — no outbox; audit rows only |
| No orphaned/dead code masking a live defect | P1-5 | **FAILED** — `resume.ts` unused, defect live |
| Static analysis runs | P1-6 | **FAILED** — lint has never worked |
| Two-database (PostgreSQL/MariaDB) decision recorded | P1-7 | **FAILED** — undecided |
| CI pipeline | P2-3 | Not a freeze gate, but noted |

---

## What a freeze would require

1. Close both P0s. P0-1 is minutes of work and removes the data-loss exposure.
2. Close P1-1, P1-2, P1-5 and P1-6 — the integrity gates that make the codebase
   mechanically verifiable rather than verified by assertion.
3. Close P1-3 — stop making a claim the product cannot honour.
4. Record decisions for P1-4 and P1-7 (they need a decision, not an implementation).
5. Re-run this evaluation and replace this verdict with dated evidence.

**Until then, this document records that the architecture is deliberately NOT
frozen, and why.** The 125-screen roadmap and the original 81-screen scope are
preserved and unaffected by this verdict.
