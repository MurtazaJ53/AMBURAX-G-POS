# AMBURAX POS — NEXT EXECUTION PLAN

Derived from: REPO_AUDIT.md, ARCHITECTURE_GAPS.md, ARCHITECTURE_FREEZE.md (2026-09-11)

**Feature development stays paused until Stage 1 is complete.** Stages are ordered
by risk removed per unit of effort, not by preference.

---

## Stage 0 — The smallest safe next step (do this first, alone)

### Initialise version control

```
cd D:\G-POS
git init
printf 'tsconfig.tsbuildinfo\n' >> .gitignore
git add -A
git status          # CONFIRM: no .env, no node_modules, no .next
git commit -m "Initial commit: AMBURAX POS A1-A11 identity and onboarding"
```

Then add a **private** remote and push.

**Why this and nothing else first:** it is the only P0 that costs minutes, it
eliminates total data-loss exposure on eleven screens of work, and it makes every
subsequent change reversible. Doing any other remediation before this one means
doing it without a safety net.

**Verification:** `git log --oneline` shows one commit; `git ls-files` lists no
`.env`, no `node_modules`, no `.next`.

**Do not** bundle any other change into this commit. It is a snapshot of reality
as audited, and its value depends on being exactly that.

---

## Stage 1 — Close the remaining blockers

Ordered. Each is small; the sequence matters more than the size.

| # | Blocker | Action | Verification |
|---|---|---|---|
| 1.1 | **P0-2** | Add `sanitizeError(err)` in `src/lib/`; replace the raw `err` in all 20 `console.error` sites | A unit test asserting a Prisma P1000 error's log output contains no connection-string prefix and no password substring |
| 1.2 | **P1-5** | Wire `onboardingResumePath()` into `src/app/(app)/home/page.tsx`, or delete `resume.ts` | Test the full chain: owner at each step signs in and lands on the right screen with no redirect loop |
| 1.3 | **P1-3** | Rewrite `src/app/auth/login/page.tsx:19` to describe only what exists | Read the page. No claim without code behind it. |
| 1.4 | **P1-6** | Add `eslint.config.mjs` (flat config, TypeScript + React plugins); fix `npm run lint` | `npm run lint` exits 0, or exits non-zero with a triaged backlog recorded |
| 1.5 | **P1-1 + P1-2** | Stand up PostgreSQL (Docker or local). Generate the baseline migration. Run the suite against it. | `npx prisma migrate status` reports up to date; 185 tests pass against a real database |
| 1.6 | **P1-2 (hard part)** | Add one genuinely concurrent integration test per atomic-claim site: A4 reset, A6 owner, A7 store, A8 invite upsert, A9 first-POS, A9 pairing, A10 completion, A11 acceptance | Two parallel real transactions; exactly one wins; the loser writes nothing |
| 1.7 | **P1-7** | Write an ADR deciding the PostgreSQL/MariaDB topology and the cross-system failure contract | ADR merged; no code required |
| 1.8 | **P1-4** | Write an ADR deciding the outbox design (table shape, dispatcher, retry, dead-letter) | ADR merged; implementation may follow later |

**Stage 1 exit criteria:** all P0 and P1 closed or explicitly accepted in writing;
`ARCHITECTURE_FREEZE.md` re-evaluated with dated evidence.

Item 1.6 is the one with real substance. Everything the project has claimed about
concurrency across eight screens currently rests on mocked Prisma. Until two real
Postgres transactions have raced, those claims are untested design, not verified
behaviour.

---

## Stage 2 — Follow-ups (schedule, do not skip)

| # | Blocker | Action |
|---|---|---|
| 2.1 | P2-1 | Delete `pnpm-lock.yaml`; state npm as the package manager in the README |
| 2.2 | P2-3 | Add a CI workflow running typecheck, lint, test, build on every push |
| 2.3 | P2-2 | Populate a real `.env` for a staging environment; exercise non-default values |
| 2.4 | P2-6 | Replace `console.error` with structured logging carrying the correlation id |
| 2.5 | P3-3 | Add an implementation-status header to every aspirational design document |

---

## Stage 3 — Resume feature work

Only after Stage 1. The queue is unchanged and the roadmap is intact.

### 3.1 — Finish A10 (Onboarding Complete)

Largely built and passing, but it carries P1-5. Completing it means wiring the
resume path, confirming the A9 to A10 redirect, and syncing documentation.

### 3.2 — A12 (Store / Workspace Selection)

The highest-value next screen. It converts `StoreMembership` — real data that A7
and A11 already produce and **no screen currently consumes** — into an active
working context, and it replaces the `/home` placeholder that every completed flow
currently dead-ends on (P2-5).

### 3.3 — A13, A14

Security Settings and Sessions/Devices. A14 is the reason sessions were modelled as
revocable DB-backed tokens (ADR-022); that decision is unrealised until it ships.

---

## What is explicitly NOT next

- **Do not start ERPNext integration.** P1-7 is undecided, and the first ERPNext
  commit is when GPLv3 obligations become live (LICENSE_RECONCILIATION.md section 2,
  action L-3). Decide the topology and create `amburax_erp` before writing any of it.
- **Do not build offline POS.** A9 delivered device identity only. The offline
  engine needs the outbox decision (P1-4) and a real database (P1-2) underneath it.
- **Do not restructure the repository.** It is coherent for its current size. A
  restructure before version control exists would be unreviewable and unrevertable.
- **Do not add Frappe apps.** License review gate, per the standing rules.

---

## Sequencing rationale

The through-line of this audit is a single pattern: **things reported as done were
not verified against the running system.** An orphaned helper looked like a fix. A
lint script looked like it ran. Concurrency tests looked like they proved database
behaviour. A login page claimed a feature that does not exist.

Stage 1 is therefore weighted toward making the codebase *mechanically* checkable —
version control, linting, a real database, real concurrency — rather than toward
adding capability. Every screen built after that inherits those checks. Every
screen built before it inherits the same blind spot that produced these findings.
