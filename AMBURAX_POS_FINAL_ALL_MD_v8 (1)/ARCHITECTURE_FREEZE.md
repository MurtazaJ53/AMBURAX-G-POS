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

## Verdict: the architecture is NOT frozen — but every P0 and P1 gate now passes

**Re-evaluated 2026-09-12. All 2 P0 and all 7 P1 blockers are closed** (see
ARCHITECTURE_GAPS.md). Every gating condition in the table below passes.

**Freezing is still premature, for two reasons that are not blockers but are real:**

1. **No CI exists (P2-3).** Every gate is run by hand. A freeze that nothing enforces
   mechanically decays the moment someone forgets to run one.
2. **The ERPNext principles below remain vacuous or untrue**, because no ERPNext exists.
   P1-7 settled the *decision*; it did not make principle 3 true. A principle that has never
   been exercised has not been proven, and freezing on that basis would record a conclusion
   the evidence does not support — the same reasoning that produced this document's original
   verdict.

**Recommended next freeze checkpoint:** after CI is running and the first ERPNext adapter has
exercised the boundary end to end.

*Original verdict, retained for history: 9 blockers were open (2 P0, 7 P1).*

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
| Repository under version control | P0-1 | **PASSED** (2026-09-11) — git initialised, 5 commits, no secrets tracked |
| No credential leakage path | P0-2 | **PASSED** (2026-09-11) — all 25 raw-error sites routed through `lib/safeLog.ts` |
| Database migrations exist | P1-1 | **PASSED** (2026-09-12) — 2 versioned migrations, reproducibility proven on a fresh database |
| Schema verified against a real database | P1-2 | **PASSED** (2026-09-12) — PostgreSQL 16.15; 64 real-database integration tests |
| No false product claims shipped | P1-3 | **PASSED** (2026-09-12) — offline/real-time/ERPNext and fabricated social-proof claims removed |
| Event/outbox foundation decided | P1-4 | **PASSED** (2026-09-12) — durable transactional outbox; ADR-070..074 |
| No orphaned/dead code masking a live defect | P1-5 | **PASSED** (2026-09-12) — `resume.ts` wired into `/home`; resume covered by unit and real-PostgreSQL tests |
| Static analysis runs | P1-6 | **PASSED** (2026-09-12) — ESLint 9 flat config, 106 files linted, 0 findings |
| Two-database (PostgreSQL/MariaDB) decision recorded | P1-7 | **PASSED** (2026-09-12) — ERPNEXT_ARCHITECTURE.md + ADR-076/077/078; two questions recorded as open, not assumed |
| CI pipeline | P2-3 | Not a freeze gate, but noted |

---

## What a freeze would require

1. Close both P0s. P0-1 is minutes of work and removes the data-loss exposure.
2. Close P1-1, P1-2, P1-5 and P1-6 — the integrity gates that make the codebase
   mechanically verifiable rather than verified by assertion.
3. Close P1-3 — stop making a claim the product cannot honour.
4. ~~Record decisions for P1-4 and P1-7~~ — **done** (ADR-070..074, ADR-076..078).
5. Re-run this evaluation and replace this verdict with dated evidence.

**Until then, this document records that the architecture is deliberately NOT
frozen, and why.** The 125-screen roadmap and the original 81-screen scope are
preserved and unaffected by this verdict.
