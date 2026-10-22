# AMBURAX POS — Web (Phase 1: Identity/Onboarding — A1-A9, A11)

## Run

**npm is the package manager** — pinned as `packageManager` in the root `package.json`.
There is one lockfile, `package-lock.json`, and CI installs with `npm ci`. A `pnpm-lock.yaml`
stub used to sit beside it; anyone who ran `pnpm install` got a divergent tree from the same
commit, so it was removed. Use `npm ci` for a reproducible install, and `npm install` only
when you intend to change dependencies.

```bash
cp .env.example .env   # point DATABASE_URL at a real Postgres
npm install
npm run prisma:migrate
npm run db:seed
npm run dev
```

Seeded accounts (password `Passw0rd!123` for both):
- `owner@demo.amburax.test` — no MFA, goes straight to `/home`.
- `manager.mfa@demo.amburax.test` — MFA enabled, routes through `/auth/verify`.

Open http://localhost:3000/auth/login.

## What's implemented

- `POST /api/v1/auth/login` — validates credentials, enforces rate limiting and
  account lockout, issues an MFA challenge when `mfaEnabled`, otherwise a
  hashed DB-backed session cookie. See `src/server/identity/`.
- `POST /api/v1/auth/verify` / `resend` — OTP challenge completion with attempt
  limits, expiry, one-time use, and independent resend cooldown.
- `POST /api/v1/auth/password/reset-request` — always returns the same
  generic "if an account exists…" response; internally issues a hashed,
  single-use, 30-minute reset token only for a real, active account not
  currently in cooldown, and supersedes any earlier unconsumed token.
- `POST /api/v1/auth/password/reset` — validates the token (hash lookup,
  expiry, single-use claimed atomically — see Security below), enforces
  password policy + confirmation + "not the same as current", updates the
  password, and revokes every existing session for that user. Never creates
  a session itself.
- `POST /api/v1/auth/logout` — revokes the session server-side.
- `POST /api/v1/tenants` — creates a Tenant (business) with zero users
  attached, idempotent on a client-generated key, rate-limited, wrapped in a
  transaction with its first `OnboardingSession`. See Tenant registration
  design notes below.
- `POST /api/v1/onboarding/owner` — resolves the A5 onboarding session,
  atomically claims the tenant's BUSINESS_CREATED → OWNER_CREATED step
  transition, creates the tenant's first `User` (tenantRole OWNER), and
  issues a real session. See Owner setup design notes below.
- `POST /api/v1/stores` — authenticated, owner-only; server-resolves the
  tenant from the session cookie (no `tenantId` in the request body at all),
  atomically claims OWNER_CREATED → STORE_CREATED, creates the `Store` and
  the owner's `StoreMembership`. See Store setup design notes below.
- `POST/GET /api/v1/invitations`, `DELETE /api/v1/invitations/:id`,
  `POST /api/v1/invitations/:id/resend` — owner-only team invitations, scoped
  to one store with one allow-listed role, opaque hashed token, 7-day expiry,
  resend cooldown, revoke. See Team invitation design notes below.
- `POST /api/v1/onboarding/team/complete` — advances STORE_CREATED →
  TEAM_INVITED. Deliberately separate from creating an invitation, because
  "Skip" is a supported path.
- `POST /api/v1/onboarding/pos` — creates the store's first POS terminal (or
  `{ skip: true }` to complete the step without one), atomically claims
  STORE_CREATED|TEAM_INVITED → POS_CONFIGURED, and returns a one-time pairing
  code. See POS setup design notes below.
- `POST /api/v1/pos/devices/activate` — public (no session): a terminal claims
  its pairing code and receives a long-lived device secret. Without this
  endpoint, "POS configured" would mean only "a row exists".
- `POST /api/v1/invitations/accept` — public (no session required), takes the
  raw token in the body; atomically claims the invitation, creates the
  `StoreMembership`, and — only when the invited email has no account yet —
  creates the STAFF `User` and issues a session. See Invitation acceptance
  design notes below.
- `/auth/login`, `/auth/verify`, `/auth/forgot-password`,
  `/auth/reset-password`, `/onboarding/business`, `/onboarding/owner`,
  `/onboarding/store`, `/onboarding/team`, `/onboarding/pos`, `/invite/[token]`,
  `/home` — real pages, not mocks;
  each resolves session/challenge/token state server- or client-side before
  rendering.

## Notification design (A2/A3/A4)

OTP codes and password reset links both go through one `IdentityNotifier`
interface (`src/server/identity/notifier.ts`). No SMS/WhatsApp/email provider
is connected yet, so the shipped adapter logs to the server console. With
`DEV_OTP_ECHO=true` / `DEV_RESET_LINK_ECHO=true` (dev only; both hard-forced
off when `NODE_ENV=production`, regardless of the env var value) the
code/link is also echoed back to the client so the flow is testable without a
real provider. This is the one intentionally-simulated part of the identity
slice so far, and it's disclosed here, not hidden — hashing, expiry, attempt
limits, replay prevention, and session issuance are all real.

## Password reset design notes (A3/A4)

- **No account enumeration** (A3): `reset-request` returns one response
  shape for unknown email, disabled account, cooldown-throttled repeat, and
  a freshly issued token alike. See SECURITY.md's "account-enumeration-safe
  pattern" section.
- **Token possession is the credential, not identity** (A4): unlike A3's
  email lookup, `/auth/reset-password` deliberately *does* distinguish
  "expired" from "invalid" — only someone who already holds the exact
  256-bit token can reach that branch at all, so the distinction leaks
  nothing to anyone who doesn't already have it. See SECURITY.md.
- **Token supersession**: issuing a new reset token invalidates every prior
  unconsumed one for that user (ADR-027) — only one link is ever valid.
- **Atomic single-use claim** (A4): found and fixed a real race in
  `consumePasswordReset()` during this build — the original code checked
  "not consumed" and later wrote "consumed" as two separate steps, so two
  concurrent requests with the same token could both pass the check. Fixed
  with a conditional `updateMany` as the first statement inside the
  transaction; the loser sees `count: 0` and the transaction aborts before
  touching the password or any session. See DECISIONS.md ADR-031 and
  SECURITY.md's "single-use token claims must be atomic" section.
- **Password policy** (A4): first password-strength check in the codebase
  (`passwordPolicy.ts`) — 8–200 chars, at least one letter and one number.
  Also rejects reusing the current password.
- **No auto-login** (A4): a successful reset does not create a session. The
  client is told to route to `/auth/login`.
- **URL hygiene** (A4): the reset token arrives via URL (unavoidable for an
  email link — see ADR-029) but the page immediately replaces the URL to
  drop the query param from the visible address bar/history. This does not
  reach upstream infrastructure logs (reverse proxy/CDN); redacting reset
  tokens from access-log query strings is a deployment concern, not an app one.

## Tenant registration design notes (A5)

- **Separate concepts, separate models**: registering a business creates a
  `Tenant` row and nothing else — no `User`, no `Store`. See DOMAIN_MODEL.md's
  identity hierarchy. Owner account (A6) and store (A7) creation are
  intentionally separate, later steps.
- **OnboardingSession, not Session**: A5 issues a new, fourth opaque-token
  model (`src/server/tenant/onboardingSession.ts`) rather than reusing
  Session — there's no User yet for a Session to belong to. See
  AUTHENTICATION.md's "pre-auth credential types."
- **Idempotent by design**: `POST /api/v1/tenants` takes a client-generated
  `idempotencyKey`; a double-click, timeout-retry, or resubmit-after-refresh
  all resolve to the same tenant. A true concurrent race (two requests, same
  key) is resolved by the database's unique constraint, not a check-then-act
  read. See SECURITY.md's "idempotent creation" section and DECISIONS.md
  ADR-037.
- **No ERPNext calls**: `Tenant.erpnextProvisionStatus` defaults to
  `NOT_PROVISIONED` and A5 leaves it there — no ERPNext adapter exists yet
  (that's Phase 2). The field exists so a future adapter has somewhere to
  record progress; nothing here pretends that provisioning happened.
- **No duplicate-business detection**: only `slug` (server-generated) and the
  idempotency key are unique. `contactEmail` is not — legitimate distinct
  businesses can share one, and the real per-person uniqueness boundary
  (`User.email`) doesn't exist until A6.

## Owner setup design notes (A6)

- **Role, not a join table**: the owner relationship is `User.tenantRole =
  'OWNER'`, not a new `TenantMembership` table — `User.tenantId` is already a
  hard 1:1 FK, so a many-to-many join would duplicate that fact. See
  DECISIONS.md ADR-041.
- **Concurrent-owner race fix**: the atomic-claim pattern from A4 (ADR-031)
  applied to a different column — `Tenant.onboardingStep`'s
  BUSINESS_CREATED → OWNER_CREATED transition is claimed with a conditional
  `updateMany` as the transaction's first statement. Two concurrent
  submissions against the same onboarding session can only have one winner;
  the loser gets `already_completed` and creates no user. See DECISIONS.md
  ADR-042.
- **OnboardingSession survives A6**: unlike A4's reset token, the onboarding
  session is NOT consumed here — A7-A10 reuse the same token. A replay after
  the owner already exists gets `already_completed`, not a fresh session
  (re-arming a login session on every replay of a 48-hour token would exceed
  what AUTHENTICATION.md says this credential is for).
- **Real session on success**: unlike A4, A6 *does* create an authenticated
  session — this is account creation, not recovery. See DECISIONS.md
  ADR-043.
- **No phone field**: `User` has no phone column and none was added — A5
  already collected `Tenant.contactPhone`, and adding an unused personal
  phone field would be ungrounded. See DECISIONS.md ADR-044.
- **"Email taken" is disclosed**, deliberately diverging from A3's
  enumeration-safe pattern — reasoned in SECURITY.md and DECISIONS.md
  ADR-045.

## Store setup design notes (A7)

- **`StoreMembership` already existed and needed no changes** — a genuine
  many-to-many join (`@@unique([userId, storeId])`, free-text `role`) present
  since the original schema. A7 only had to use it correctly: one
  `role: 'OWNER'` row per first store, not an automatic grant from
  `tenantRole`. See DECISIONS.md ADR-046 and PERMISSIONS.md.
- **No separate Location/Warehouse model**: `Store` already *is* the
  Amburax-side location/warehouse concept (ERPNEXT_DOCTYPE_MAP.md: "Store ->
  Warehouse/Company setup"). ERPNext provisioning fields
  (`erpnextProvisionStatus`, `erpnextWarehouseId`) live on the same row,
  reusing Tenant's existing enum. See DECISIONS.md ADR-047.
- **No speculative ERPNext adapter**: rather than write an `ErpnextAdapter`
  interface with a stub nobody calls, the provisioning contract Phase 2 must
  implement is documented in ERPNEXT_DOCTYPE_MAP.md instead.
  `Store.erpnextProvisionStatus` stays `NOT_PROVISIONED`. See DECISIONS.md
  ADR-048 and SECURITY.md's "don't build an adapter with no caller."
  Deliberately **not** built here to avoid exactly the half-integration risk
  called out for this screen.
- **Concurrent-first-store fix**: same atomic-claim shape as A4/A6
  (ADR-031/ADR-042), applied again — `OWNER_CREATED -> STORE_CREATED` is
  claimed as the transaction's first statement. No client idempotency key is
  needed (unlike A5) — the onboarding-step transition is already the correct
  one-time gate. See DECISIONS.md ADR-049.
- **Server-resolved scope**: `POST /api/v1/stores` accepts no `tenantId`,
  `ownerId`, or `storeId` in its body at all — everything comes from the
  session cookie. See DECISIONS.md ADR-050 and SECURITY.md.

## Team invitation design notes (A8)

- **`Invitation` is its own credential model** — a fifth opaque-token model
  alongside Session/OnboardingSession/PasswordResetToken/MfaChallenge, sharing
  only `token.ts`'s generate/hash helpers, never a table. Status is derived
  from `acceptedAt`/`revokedAt`/`expiresAt`, not a stored enum. See
  DECISIONS.md ADR-051.
- **Role allow-list, not a schema enum**: `StoreMembership.role` stayed a free
  string (changing it would rebuild working A7 infrastructure), so the
  privilege-escalation guard lives in `storeRoles.ts`'s
  `INVITABLE_STORE_ROLES`. `OWNER` is permanently excluded — it can never be
  requested through an invitation payload. A11 must reuse the same list. See
  DECISIONS.md ADR-052.
- **A real concurrency bug was found and fixed here**: the first cut
  superseded pending invites with a read-then-write inside a transaction, which
  raced under double-click (two overlapping requests could both create a live
  invitation for the same email+store). Replaced with
  `@@unique([tenantId, storeId, email])` + a single atomic `upsert` — one
  statement, so no window exists to race in. See DECISIONS.md ADR-054 and
  SECURITY.md's "prefer one atomic statement over a conditional claim."
- **Skip is a first-class path**: the A8 wireframe's Skip/Continue buttons
  settle what `TEAM_INVITED` means — the step was completed, not "≥1
  invitation exists". `completeTeamStep()` is a separate operation from
  creating an invitation. See DECISIONS.md ADR-053.
- **The raw token is never returned to the inviter** — unlike A5's onboarding
  token (where the same browser continues the flow), the person who completes
  an invitation is a *different* person, so the token leaves only through the
  notifier. `DEV_INVITE_LINK_ECHO` (dev-only, hard-forced off in production)
  is the sole exception, for local testing without an email provider.
- **Deterministic duplicate handling**: existing membership → `already_member`;
  email belonging to another tenant → `email_unavailable` (globally unique
  `User.email` means that invite could never be accepted); existing tenant
  member without this store's membership → allowed, same invite flow. No fuzzy
  matching anywhere. See DECISIONS.md ADR-055.

## Invitation acceptance design notes (A11)

- **One token lookup in the whole system**: `invitation.ts`'s private
  `findInvitationByToken()` backs both `resolveInvitation()` (strict — returns
  an invitation only when it is acceptable right now) and `previewInvitation()`
  (renders why it isn't). A11 added no second validation path.
- **A11 never verifies a password.** For an email that already has an account,
  acceptance requires an already-authenticated session for that exact email;
  otherwise `login_required`. Reason: A1 routes any `mfaEnabled` account
  through A2's challenge before issuing a session, so a second password check
  inside A11 would have been an MFA bypass for every existing account with MFA
  on, reachable by anyone holding the invite link. The accepted cost is a UX
  seam ("sign in, then reopen the link"), chosen over a `next=` redirect that
  would add an open-redirect surface to a public token-bearing URL. See
  DECISIONS.md ADR-056/057.
- **A forwarded link cannot cross identities**: a live session whose email
  differs from the invitation's is `identity_mismatch`, blocked server-side
  (the client-side version of the same check is UX only). See ADR-058.
- **Claim first, then write**: the acceptance transaction's first statement is
  `updateMany({ where: { id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } })`.
  It locks the invitation row for the transaction's life, so a concurrent
  acceptance blocks, then fails with `count: 0` having created no user, no
  membership, and no session. Session creation is deliberately *outside* the
  transaction: a transient session-write failure must not roll back a
  legitimate acceptance. See ADR-059.
- **Role re-validated at acceptance**, not only at creation, against
  `INVITABLE_STORE_ROLES`; `tenantRole` is hard-coded `STAFF` on the
  new-account path and untouched on the existing-account path, so an
  invitation can never mint or promote an OWNER. See ADR-060.
- **No cookie on any failure path** — the session cookie is set only when the
  service actually returned a session token, and the response carries
  `authenticated` so the client knows which happened.
- **A11 does not touch `Tenant.onboardingStep`.** Accepting an invitation is
  not an onboarding step and must not move the owner's setup state machine.

## POS setup design notes (A9)

- **`PosDevice` is its own entity** — not a Store, not a User, not a warehouse.
  A terminal doesn't log in, holds no role, is many-per-store, and must be
  revocable without touching anyone's identity. OFFLINE_POS.md §9 already
  required this shape (Tenant → Store → POS Terminal → Device) so offline
  transactions can be attributed to the device that produced them. Fields are
  grouped identity / credentials / configuration / runtime, and `lastSeenAt`
  (runtime) is deliberately not stored as configuration. See ADR-061.
- **A created row is not a working POS.** `createdAt` and `activatedAt` are
  separate facts. The setup screen produces `PENDING_ACTIVATION` and says
  "awaiting pairing" — never "POS ready". Status is derived from timestamps
  (PENDING_ACTIVATION / PAIRING_EXPIRED / ACTIVE / DISABLED), same convention
  as Invitation. See ADR-062.
- **Two credentials, not one**: a one-time pairing code (CSPRNG, ~100 bits,
  Crockford base32 with no look-alike characters, short TTL, hashed, shown to
  the human exactly once) and a separate long-lived 256-bit device secret
  issued to the machine at activation, also hashed. A single code would make
  the string a merchant reads off a screen the terminal's permanent
  credential. Neither reuses Session/OnboardingSession/PasswordResetToken/
  MfaChallenge/Invitation — only `token.ts`'s hash helper is shared. See
  ADR-065.
- **The wireframe's invoice prefix / start number / default customer / price
  list are deliberately NOT collected.** Invoice numbering is
  ERPNext-authoritative (OFFLINE_POS.md §10) and an Amburax start number would
  be a second authoritative counter; customers and price lists are ERPNext-owned
  records nothing here can validate yet. Those fields belong to screen 74. See
  ADR-063.
- **No ERPNext field on the model at all** — unlike Tenant→Site and
  Store→Warehouse, there is no documented terminal doctype. What ERPNext owns is
  the invoices the till later posts. A provisioning column with no pipeline
  behind it would imply an integration that doesn't exist. See ADR-064.
- **Both A8 paths are supported**: the step claim accepts STORE_CREATED *and*
  TEAM_INVITED, because A8's Skip is real. Requiring TEAM_INVITED would have made
  onboarding uncompletable for every tenant that skipped the team step. A9 has
  its own Skip for the same reason — a warehouse has no till. See ADR-067.
- **Claim first, then create**: the conditional `updateMany` on the tenant's step
  is the transaction's first statement, so two tabs submitting *different* device
  codes cannot both win — which `@@unique([storeId, code])` alone would not have
  caught. The unique index still handles the same-code race and will protect the
  future multi-POS path where no onboarding step gates creation.
- **Revoke, don't delete**: sales will reference `posDeviceId` permanently, so a
  compromised terminal is disabled via `disabledAt`. DISABLED outranks every
  other derived state and activation refuses it even with a valid code. See
  ADR-066.
- **A real systemic bug was found and fixed here**: smoke-testing with the
  database deliberately unreachable showed `/home`, `/onboarding/store` and
  `/onboarding/team` all returning raw HTTP 500s, while every API route and
  A11's public invite page degraded politely. All now render a shared
  "Temporarily unavailable" screen. Only data loads are wrapped, never
  `redirect()` — Next implements it by throwing. See ADR-069.

## Known gaps (tracked, not hidden)

- No real SMS/WhatsApp/email provider — see notification design notes above.
- Store selection (A12) isn't built — `/home` is a placeholder proving the
  session pipeline, not the real dashboard (screen 15). After A7 the owner
  lands there too, same placeholder.
- **No POS client exists.** `POST /api/v1/pos/devices/activate` is real,
  tested and curl-able, but nothing ships that a merchant can install on a
  counter device to call it. Until one exists, terminals created at A9 stay at
  PENDING_ACTIVATION in practice. This is disclosed on the screen itself, not
  hidden.
- **No pairing-code regeneration and no revoke UI.** The data model supports
  both (`pairingCodeHash` is nullable, `disabledAt` exists) and the A9 screen
  tells the merchant to use POS Configuration — which is screen 74 and not
  built. A merchant who loses a pairing code today has no in-product recovery.
- **`lastSeenAt` is written only at activation.** There is no heartbeat, so it
  does not yet mean "recently online". The online/offline/syncing model belongs
  to the offline engine (OFFLINE_POS.md §4), which is entirely unbuilt — A9
  establishes device identity only and claims no offline capability.
- **`npm run lint` does not work and never has** — `next lint` was removed in
  Next 16 and no `eslint.config.*` exists in this workspace. Pre-existing, not
  introduced by A9, and not fixed here because adding a config would surface a
  backlog of findings across nine screens that deserves its own pass.
- `InvitationAccepted` is written to the audit log, not published as a domain
  event — the durable outbox of DECISIONS.md ADR-010 doesn't exist yet, so
  nothing downstream (ERPNext user provisioning, notifications) reacts to an
  acceptance.
- An accepted STAFF user lands on the `/home` placeholder like everyone else.
  Store selection (A12) is what will turn a `StoreMembership` into an active
  working context; until then the membership is real data that no screen
  consumes.
- No real ERPNext Warehouse provisioning — see Store setup design notes
  above. This is an intentional, documented deferral, not an oversight.
- All ten built identity/tenant/POS screens (A1–A9, A11) are covered by pure-logic and
  mocked-service unit tests (hashing, masking, lockout/cooldown math, token
  round-trips, slug generation, role allow-list, invitation state derivation,
  and — for A4's, A5's, A6's, A7's, A8's, A9's, and A11's race fixes specifically —
  mocked-Prisma tests proving the code aborts/recovers/uses-an-atomic-statement
  when a concurrent write could otherwise win) plus a live smoke test
  against an unreachable DB (confirms graceful 503s, and that malformed
  input/missing auth gets a distinct 400/401 without touching the DB). No
  live Postgres was available in the build sandbox, so none of this has been
  run against a real database — the mocked race tests prove the *code's*
  handling of a lost race, not Postgres's actual transaction/constraint
  behavior under real concurrent load. Do the full run once `DATABASE_URL`
  points at a real database.

## Git History Warning & Secret Rotation

> [!WARNING]
> **CRITICAL SECURITY REQUIREMENT BEFORE PRODUCTION DEPLOYMENT**:
> If any secret, token, database URL, API key, or credential was ever previously committed or hardcoded anywhere in the codebase (including initial commits, test fixtures, or local configs), **that old value still resides permanently in Git history**.
> 
> Before deploying this application to production:
> 1. **Rotate all credentials immediately**: Change database passwords, reissue any ERP/SMS/email API keys, regenerate OAuth tokens, and update session secrets.
> 2. **Never commit `.env`**: Confirm `.env` and `.env.*` files remain gitignored and are never staged.
> 3. **Clean git history**: If sensitive production secrets were committed in historical commits, use `git-filter-repo` or BFG Repo-Cleaner to permanently scrub them from the repository history.

## Tests

```bash
npm run typecheck
npm run test
npm run build
```
