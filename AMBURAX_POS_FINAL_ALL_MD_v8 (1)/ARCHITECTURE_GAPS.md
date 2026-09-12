# AMBURAX POS — ARCHITECTURE GAPS

Audit date: 2026-09-11
Source of truth: REPO_AUDIT.md (actual repository inspection, 2026-09-11)

Severity:

| Level | Definition |
|---|---|
| **P0** | Security, data-loss or license-critical blocker. Fix before any further feature work. |
| **P1** | Architecture or integrity blocker. Fix before the architecture can be frozen. |
| **P2** | Important follow-up. Schedule, do not ignore. |
| **P3** | Future improvement. Record and revisit. |

---

## P0 — BLOCKERS

### P0-1 — The project is not under version control
**Evidence:** `git status` returns `fatal: not a git repository`. No `.git` anywhere.
**Impact:** Total data-loss exposure. Eleven screens of work (A1–A9, A11, plus an
in-progress A10) exist only as untracked files on one disk. No history, no revert,
no branch, no review, no off-machine copy. A single disk failure or bad `rm` ends
the project.
**Why P0:** This is the definition of a data-loss blocker, and it also makes every
other remediation unsafe — there is nothing to roll back to.
**Fix:** `git init`, add `apps/web/tsconfig.tsbuildinfo` to `.gitignore`, verify
`.env` is excluded, commit the current tree, push to a private remote.
**Effort:** minutes.

### P0-2 — Database credentials can be written to logs
**Evidence:** 20 sites of the form
`console.error("[route] message", { correlationId, err })`. Prisma connection
errors (e.g. P1000) embed the full `DATABASE_URL`, including its password, in
`err.message`.
**Impact:** Any connection blip writes production database credentials to stdout,
and from there to whatever log aggregator is eventually attached. This violates
the standing rule "Never log secrets or sensitive data unnecessarily."
**Fix:** A single `sanitizeError(err)` helper that logs `err.name`, a redacted
message, and the stack — never the raw object. Apply at all 20 sites.
**Effort:** about one hour.

---

## P1 — ARCHITECTURE / INTEGRITY BLOCKERS

### P1-1 — No database migrations exist
**Evidence:** `prisma/migrations/` does not exist. `schema.prisma` has only ever
been applied by generate/push.
**Impact:** There is no way to evolve a populated database. The first real
deployment cannot be upgraded, and there is no rollback path. DATABASE_STRATEGY.md
describes a migration discipline that has never been executed once.
**Fix:** Generate an initial baseline migration and require one per schema change
from then on.

### P1-2 — No live PostgreSQL has ever run this code
**Evidence:** `prisma migrate status` returns
`P1000: Authentication failed ... for user amburax`.
**Impact:** Every concurrency guarantee in A4, A6, A7, A8, A9, A10 and A11 — the
atomic-claim pattern, the unique-constraint races, the pairing-code claim — is
proven **only against mocked Prisma**. The tests prove the code's handling of a
lost claim; they do not prove PostgreSQL's row-locking, isolation level, or
constraint behaviour under real parallel load.
**Fix:** Stand up PostgreSQL, run the suite against it, and add at least one
genuinely concurrent integration test per claim site.

### P1-3 — The product advertises a capability that does not exist
**Evidence:** `src/app/auth/login/page.tsx:19` — "Fast barcode checkout,
offline-capable POS, and real-time stock across stores." Verified: there is no
offline storage, no queue, no sync, no barcode path, and no stock anywhere.
**Impact:** Three false product claims on the first screen a user sees. This is
precisely the fake-completion pattern the project rules forbid, and it is
user-visible today.
**Fix:** Replace with copy describing what exists, or mark the page as
pre-release. One-line change; the discipline matters more than the effort.

### P1-4 — No durable event/outbox infrastructure
**Evidence:** No `Event`/`Outbox`/`DomainEvent` model in `schema.prisma`.
EVENTS.md lists roughly sixteen domain events; all are `AuditLog` rows and nothing
consumes them.
**Impact:** ADR-010 makes the outbox load-bearing for side effects, channel sync
and reconciliation. Everything downstream of it — commerce, AI actions,
notifications — has no foundation. Writing an audit row and calling it an event is
the anti-pattern the docs explicitly warn against.
**Fix:** Design the outbox before the first side-effecting integration, not after.

### P1-5 — Orphaned dead code, and the defect it was meant to fix is still live — **CLOSED 2026-09-12**

**Resolution:** `getOnboardingResume()` is now called by `src/app/(app)/home/page.tsx`, the
single point every authenticated entry path funnels through (sign-in, MFA completion, the
root redirect, a bookmark, a refresh). An owner at OWNER_CREATED / STORE_CREATED /
TEAM_INVITED / POS_CONFIGURED is redirected to the screen that accepts that step; a
COMPLETE tenant and any STAFF user are never redirected. Wiring it surfaced a latent
redirect loop for a tenant whose step implies a Store that does not exist — that state now
stops with an explicit notice instead of cycling. No schema change. See ADR-075.

*Original finding, retained for history:*
**Evidence:** `src/server/onboarding/resume.ts` exports `onboardingResumePath()`;
repository-wide grep finds no importer. `LoginForm.tsx:43` and `VerifyForm.tsx:152`
both push to `/home`.
**Impact:** An owner who signs back in mid-onboarding lands on the `/home`
placeholder with no route back into setup. The helper written to fix it was never
wired in, because the A10 build was interrupted.
**Fix:** Either import it in `src/app/(app)/home/page.tsx` and test the redirect
chain, or delete the file. **Do not leave it as is** — orphan code that looks like
a fix is worse than no fix.

### P1-6 — No static analysis runs anywhere
**Evidence:** `npm run lint` fails; `next lint` was removed in Next.js 16 and no
`eslint.config.*` exists in the workspace.
**Impact:** Roughly seventy-five source files have never been linted. No
unused-variable, no floating-promise, no `react-hooks/exhaustive-deps`, no
security-rule coverage. Combined with P0-1, nothing mechanical is checking this
codebase at all.
**Fix:** Add a flat ESLint config with the TypeScript and React plugins; expect an
initial backlog and triage it.

### P1-7 — The two-database question is undecided
**Evidence:** AMBURAX runs PostgreSQL. Frappe/ERPNext requires MariaDB. No
document states how they coexist.
**Impact:** The first ERPNext write path cannot be designed correctly without
answering: shared host or not; what happens when the AMBURAX transaction commits
and the ERPNext call fails; which system is authoritative during a sale; backup
and restore ordering. Getting this wrong produces exactly the duplicate-ledger
failure the architecture exists to prevent.
**Fix:** A decision record before any ERPNext code.

---

## P2 — IMPORTANT FOLLOW-UPS

### P2-1 — Two conflicting lockfiles
`package-lock.json` (123 KB, real) and `pnpm-lock.yaml` (114 B, stub). A
contributor running `pnpm install` gets a divergent tree. Delete the unused one and
state the package manager in the README.

### P2-2 — `.env` covers 5 of 34 documented keys
The other 29 fall back to defaults in `src/lib/env.ts`, so nothing breaks — but no
environment has ever exercised a non-default TTL, rate limit or pairing window.
Production values have never been tested.

### P2-3 — No CI, no Docker, no deployment definition
No workflow file, no `Dockerfile`, no compose file, no infra directory. DEVOPS.md
describes a pipeline that does not exist. Every gate (typecheck, test, build) is
run by hand today.

### P2-4 — Weak-copyleft dependencies present (no action required yet)
`lightningcss` and `lightningcss-win32-x64-msvc` are MPL-2.0; `@img/sharp-wasm32`
and `@img/sharp-win32-x64` carry LGPL-3.0-or-later components. All four are
Next.js build/native dependencies, file-level copyleft, not statically linked into
proprietary source. **Zero UNKNOWN licenses, zero GPL/AGPL.** Recorded so the
position is deliberate rather than accidental. See LICENSE_RECONCILIATION.md.

### P2-5 — `/home` is a placeholder standing in for the real workspace
Every completed flow — login, MFA, invitation acceptance, onboarding completion —
terminates at a placeholder card. A12 (Store Selection) and screen 15 (Dashboard)
are what make it real. Acceptable today, but it means no flow has an actual
destination.

### P2-6 — No observability
No structured logging, no metrics, no tracing, no error reporting. Only
`console.error` with a correlation id. OBSERVABILITY.md describes none of what
exists.

---

## P3 — FUTURE IMPROVEMENTS

### P3-1 — No E2E tests
185 unit/service tests, zero browser tests. The multi-screen onboarding chain
(A5 to A6 to A7 to A8 to A9 to A10) is only verified per-screen.

### P3-2 — No SBOM artifact
The license inventory in this audit was produced ad hoc. A generated SBOM should
become a build output.

### P3-3 — Documentation/implementation drift is unlabelled
MICROSERVICES.md, COMMERCE_ENGINE.md, CAPACITY_TESTING.md, DISASTER_RECOVERY.md and
SCALABILITY.md describe systems with zero code. They are legitimate forward design
but do not say so. Each should carry an explicit implementation-status header.

### P3-4 — Framework-version drift went unnoticed
Next.js 16 removed `next lint` and the project did not notice for nine screens.
A dependency-upgrade checklist would have caught it.

---

## Summary

| Severity | Count | Ids |
|---|---|---|
| P0 | 2 | P0-1, P0-2 |
| P1 | 7 | P1-1 through P1-7 |
| P2 | 6 | P2-1 through P2-6 |
| P3 | 4 | P3-1 through P3-4 |

**The architecture cannot be frozen while any P0 or P1 remains open.** See
ARCHITECTURE_FREEZE.md.
