# AMBURAX POS — REPOSITORY AUDIT

Audit date: 2026-09-11
Method: read-only inspection of the actual repository. No production code was modified.
Scope: `D:\G-POS`

---

## 1. Version control — CRITICAL FINDING

```
$ git status --short
fatal: not a git repository (or any of the parent directories): .git
```

**`D:\G-POS` is not a git repository.** There is no `.git` directory anywhere
(`find . -maxdepth 4 -name .git` returns nothing).

Consequently there is:
- no branch
- no remote
- no commit history
- no diff, no blame, no revert, no bisect
- no code review surface
- no backup outside this single machine's filesystem

A `.gitignore` exists at the root and is correctly written
(`node_modules/`, `.next/`, `.env`, `.env.local`, `*.log`) — it has simply never
been used, because no repository was ever initialised.

Every screen A1–A9 and A11 exists **only** as untracked files on one disk. This is
the single highest-severity finding in this audit and is recorded as **P0-1**.

---

## 2. Repository layout (actual)

```
D:\G-POS
├── .gitignore
├── package.json            (workspace root: { "workspaces": ["apps/*"] })
├── package-lock.json       (123 KB — the real lockfile)
├── pnpm-lock.yaml          (stub: importers { . } — no packages)
├── node_modules/           (114 top-level entries)
├── apps/
│   └── web/                (the ONLY application)
└── AMBURAX_POS_FINAL_ALL_MD_v8 (1)/   (38 specification documents)
```

**There is exactly one application.** There is no `services/`, no `packages/`, no
`scripts/`, no `infra/`, no `Dockerfile`, no `docker-compose.yml`, no CI
configuration, and no `amburax_erp/` layer.

### Package managers — conflict

Two lockfiles are present for one dependency graph:

| File | Size | State |
|---|---|---|
| `package-lock.json` | 123 KB | Real, populated, matches `node_modules` |
| `pnpm-lock.yaml` | 114 B | Stub — zero packages |

npm is the de-facto manager. The pnpm stub is inert but misleading: any
contributor running `pnpm install` would produce a divergent tree. Recorded as
**P2-1**.

---

## 3. `apps/web` — the application

Next.js 16.3.4 (App Router) + React 19.2.8 + TypeScript 5.9.3 (strict,
`noUncheckedIndexedAccess`) + Tailwind 3.4.19 + Prisma 5.22.0 + Vitest 5.0.0.

Frontend and backend are **not** separately deployable. They are one Next.js
process: React Server/Client Components for UI, Route Handlers under
`src/app/api/v1/**` for the API, and a server-only layer under `src/server/**`.
This matches ADR-020 (Phase-1 identity service as Route Handlers, extractable
later) — it is a documented choice, not drift.

### Boundary verification

- `grep` for `@/server/db` inside any file marked `"use client"` → **zero hits.**
  No client component touches the database.
- All `src/server/**` modules are server-only and reached exclusively through
  Route Handlers or Server Components.

### Database

- PostgreSQL via Prisma. `prisma validate` → **schema is valid.**
- 12 models: `Tenant`, `OnboardingSession`, `Store`, `PosDevice`, `User`,
  `StoreMembership`, `Invitation`, `Session`, `LoginAttempt`, `MfaChallenge`,
  `PasswordResetToken`, `AuditLog`.
- **`prisma/migrations/` does not exist.** There is no migration history
  whatsoever. There is no forward migration, no rollback, and no way to evolve a
  populated database safely. Recorded as **P1-1**.
- `prisma migrate status` → `P1000: Authentication failed against database server
  at localhost` for user `amburax`. **No live PostgreSQL is reachable from this
  environment.** Every concurrency guarantee claimed in A4–A11 is proven against
  mocked Prisma only. Recorded as **P1-2**.
- `prisma/seed.ts` exists and is wired to `npm run db:seed`.

### Configuration

`apps/web/.env` exists and contains **5 keys**. `.env.example` documents **34**.

Keys present in `.env` (values redacted, never printed):
`DATABASE_URL`, `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS`,
`LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES`.

The 29 absent keys all have defaults in `src/lib/env.ts`, so the application
boots — but no environment has ever exercised a non-default value for A3–A10's
TTLs, rate limits, or pairing windows. Recorded as **P2-2**.

---

## 4. Screen implementation evidence (A1–A14)

Verified from actual routes, services and tests — **not** from prior reports.

| Screen | Route | Service | Tests | Verdict |
|---|---|---|---|---|
| A1 Login | `/auth/login` | `loginService.ts` | `loginGuard`, `password`, `maskEmail` | **BUILT** |
| A2 Verify/MFA | `/auth/verify` | `mfaChallenge.ts`, `otp.ts` | `otp.test.ts` | **BUILT** |
| A3 Forgot | `/auth/forgot-password` | `passwordReset.ts` | `passwordReset.test.ts` | **BUILT** |
| A4 Reset | `/auth/reset-password` | `passwordReset.ts` | `passwordReset.consume.test.ts` | **BUILT** |
| A5 Registration | `/onboarding/business` | `registrationService.ts` | `registrationService`, `tenantSlug` | **BUILT** |
| A6 Owner | `/onboarding/owner` | `ownerSetup.ts` | `ownerSetup.test.ts` | **BUILT** |
| A7 Store | `/onboarding/store` | `storeSetup.ts` | `storeSetup.test.ts` | **BUILT** |
| A8 Team | `/onboarding/team` | `invitation.ts`, `teamStep.ts` | `invitation`, `teamStep`, `storeRoles` | **BUILT** |
| A9 POS Setup | `/onboarding/pos` | `posDeviceSetup.ts`, `posDeviceActivation.ts` | `posDeviceSetup`, `posDeviceActivation` | **BUILT** |
| A10 Complete | `/onboarding/complete` | `readiness.ts`, `completeOnboarding.ts` | `onboardingReadiness.test.ts` | **BUILT (one defect — see §5)** |
| A11 Accept Invite | `/invite/[token]` | `invitationAcceptance.ts` | `invitationAcceptance.test.ts` | **BUILT** |
| A12 Store Select | — | — | — | **NOT BUILT** |
| A13 Security Settings | — | — | — | **NOT BUILT** |
| A14 Sessions/Devices | — | — | — | **NOT BUILT** |

32 routes build successfully. 19 test files, 185 tests, all passing.

### A9 device activation — verified real

`POST /api/v1/pos/devices/activate` exists and is genuinely implemented:
one-time pairing code (CSPRNG, Crockford base32, sha256-hashed at rest, consumed
atomically) exchanged for a long-lived hashed device secret.
`derivePosDeviceStatus` returns `PENDING_ACTIVATION | PAIRING_EXPIRED | ACTIVE |
DISABLED` from timestamps — a created row is correctly **not** reported as an
active terminal.

### Offline POS — DOES NOT EXIST

Searched `src/**` for `indexeddb`, `service worker`, `localStorage`, `sqlite`,
`outbox`, `syncQueue`, `offline`. Three matches, all inert:

- `src/app/auth/login/page.tsx:19` — marketing copy
- `completeOnboarding.ts:93` — a comment stating the outbox does not exist
- `posDeviceActivation.ts:38` — a doc reference to OFFLINE_POS.md §28

**There is no local database, no durable queue, no sequence numbering, no sync
pipeline, no reconciliation, and no mode state machine.** A9 delivered device
*identity* — the precondition for offline work, not offline work itself.

**The login page currently advertises "offline-capable POS" to users.** That is a
product claim the system cannot honour. Recorded as **P1-3**.

### Events / outbox — DOES NOT EXIST

There is no `Event`, `Outbox`, or `DomainEvent` model in the schema. Everything
EVENTS.md lists as an event (`InvitationCreated`, `PosDeviceActivated`,
`OnboardingCompleted`, …) is written to `AuditLog` only. Nothing downstream
consumes anything. ADR-010's durable outbox is unimplemented. Recorded as **P1-4**.

---

## 5. Defect found during this audit

`src/server/onboarding/resume.ts` exports `onboardingResumePath()`. A repository-wide
grep for `onboardingResumePath` and `onboarding/resume` returns **only its own
declaration** — nothing imports it.

It is orphaned dead code, created during an A10 build that was interrupted before
the consuming edit to `src/app/(app)/home/page.tsx` was made. The underlying
defect it was written to fix is therefore **still live**: an owner who signs back
in mid-onboarding lands on the `/home` placeholder with no route back into setup
(`LoginForm.tsx:43` and `VerifyForm.tsx:152` both push to `/home`).

Recorded as **P1-5**. This is exactly the class of "trust the report, not the code"
error this audit was commissioned to catch.

---

## 6. Quality gate results (actual commands, actual output)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **PASS** — clean, no output |
| Lint | `npm run lint` | **FAIL** — see below |
| Tests | `npm run test` | **PASS** — 185 tests, 19 files |
| Build | `npm run build` | **PASS** — compiled in 8.9 s, 30 static pages, 32 routes |
| Schema | `npx prisma validate` | **PASS** |
| Migrations | `npx prisma migrate status` | **FAIL** — P1000, no database reachable |

### Lint is broken repo-wide

```
$ npm run lint
npm error command failed
npm error command ... next lint
```

`next lint` was removed in Next.js 16, and there is **no `eslint.config.*` anywhere
in the workspace**. The `lint` script has never worked. There is no static analysis
of any kind running over ~75 source files. Recorded as **P1-6**.

---

## 7. Security review

**No hardcoded production secrets found.** Pattern search across `src/**` for
password/secret/apikey/token/credential literals returned two hits, both test
fixtures (`"Correct-Horse-9"` in `invitationAcceptance.test.ts` and
`ownerSetup.test.ts`). No `BEGIN ... PRIVATE KEY` blocks anywhere.

**Tenant isolation holds.** No API route accepts `tenantId` or `ownerId` from the
client — both are resolved from the session cookie server-side. `storeId` is
accepted on two endpoints (`POST /invitations`, `POST /onboarding/pos`) and both
authorization-check it against the caller's tenant before any write, returning an
identical "not found" for cross-tenant and nonexistent ids (no enumeration oracle).

**No privileged ERPNext credentials can reach the browser** — because no ERPNext
credentials exist at all (see ERPNext_VERSION_PIN.md).

**Logging:** 20 `console.error` sites, all of the shape
`console.error("[route] message", { correlationId, err })`. No credential or token
is logged deliberately. **However**, Prisma connection errors can embed the
`DATABASE_URL` — including its password — in `err.message`. Logging the raw `err`
object therefore risks writing database credentials to stdout on any connection
failure. Recorded as **P0-2**.

---

## 8. Generated / untracked files

With no git, *everything* is untracked. Files that would need ignoring on
initialisation and are already covered by the existing `.gitignore`:
`node_modules/`, `.next/`, `.env`, `*.log`.

One file is **not** covered: `apps/web/tsconfig.tsbuildinfo` (147 KB build
artifact). It should be added to `.gitignore` before the first commit.

---

## 9. Architecture conflicts observed

1. **Documentation describes an architecture that does not exist.** MICROSERVICES.md,
   COMMERCE_ENGINE.md, OFFLINE_POS.md, DEVOPS.md, DISASTER_RECOVERY.md and
   CAPACITY_TESTING.md all describe systems with zero corresponding code. This is
   acceptable as forward design, but the documents do not consistently say so.
   ARCHITECTURE_GAPS.md now records the delta.
2. **The `amburax_erp` layer mandated by the architecture rules does not exist** —
   correctly, because ERPNext itself does not exist yet. The boundary is currently
   trivially satisfied, which is not the same as proven.
3. **The 125-screen roadmap is intact.** SCREEN_MAP.md contains 126 numbered lines
   (125 screens plus header) and SCREEN_SPECIFICATIONS.md contains 14 A-series
   specs. Nothing has been deleted or renumbered.
