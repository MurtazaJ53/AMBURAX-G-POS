# AMBURAX POS — Security

- tenant isolation
- store-scoped authorization
- secure sessions
- MFA
- server-side RBAC
- secret vaulting
- audit logging

Never expose ERPNext credentials, marketplace tokens, payment keys, webhook secrets or AI provider keys to clients.

Validate webhook authenticity and external inputs.

Server-side validation is mandatory for price, tax, discount, payment, refund, credit and stock.

Treat AI output as untrusted; tool calls are permission/policy checked.

## Account-enumeration-safe pattern (established by A3 — Forgot Password)

Any flow that asks "does this identifier (email/phone/username) exist" — password
reset, invite lookup, username availability, etc. — must satisfy all of:

- One response body for every non-rate-limited outcome. Unknown identifier, disabled
  account, and already-throttled repeat requests all return the exact same message as
  a genuine new request. Only a rate-limit response may differ, because it describes
  the requester's own behavior, not the target's existence.
- Equivalent server-side cost on every branch. If the "found" path does a bcrypt
  compare/hash, the "not found" path must burn the same cost (a fixed dummy hash),
  otherwise response timing becomes the oracle even when the response body is generic.
- Throttling is silent. A cooldown-suppressed repeat request still returns the generic
  success response; it just skips sending another message.
- Replay/reuse of a token returns the same response as a token that never existed.

## Single-use token claims must be atomic (established by A4 — Reset Password)

Every "this token grants one action, then it's dead" flow (password reset, and by
extension MFA challenges, invitation acceptance, etc.) must claim the token with a
single conditional write inside the transaction that performs the action, not a
separate read-then-write:

- Bad: `findUnique` to check `consumedAt IS NULL`, then a later unconditional
  `update` to set it. Two concurrent requests with the same token can both pass the
  check before either write commits — the "single-use" guarantee isn't atomic.
- Correct: the transaction's first statement is `updateMany({ where: { id, consumedAt:
  null, expiresAt: { gt: now } } })`. Only one concurrent caller's write can match;
  everyone else sees `count: 0` and the transaction aborts before the token's action
  (password change, session issuance, etc.) ever runs.

A4 had exactly the first (buggy) shape until this was found during its own
implementation — see DECISIONS.md ADR-031.

## When token possession, not identity, is the credential

Not every "invalid" needs to hide behind a generic message the way A3's account
lookup does. If the only way to reach a code path is to already possess a
high-entropy (≥128-bit), unguessable token — a password reset link, not a 6-digit
OTP — then distinguishing "expired" from "invalid" leaks nothing to anyone who
doesn't already hold the exact token, and is meaningfully better UX. Reserve the
single-generic-response treatment for flows keyed on a guessable or enumerable
identifier (email, OTP, username).

## CSRF and reset endpoints

`POST /api/v1/auth/password/reset` is not a CSRF target: it carries no ambient
session/cookie authority (A4 deliberately never sets a session cookie — see
DECISIONS.md ADR-033) and authorizes purely on possession of the reset token in the
request body. A forged cross-site request cannot supply a token it doesn't have, and
if an attacker does have the token, CSRF protection was never the relevant barrier.
Endpoints that mutate state using the *session cookie* as authority still need
`sameSite` cookies (already the default here) or an explicit CSRF token.

## Idempotent creation (established by A5 — Business Registration)

Any endpoint that creates a durable, hard-to-undo resource in response to a public,
retry-prone client action (registration, order placement, payment initiation) needs a
client-supplied idempotency key, not just client-side "disable the button after click":

- The key is stored as a nullable, unique column on the created resource itself
  (`Tenant.registrationKey`), not a separate staging table — one less place for the
  two to drift out of sync.
- A repeat request with the same key looks up and returns the existing resource
  instead of creating a new one. If the resource's original response contained
  something unrecoverable (a token whose plaintext was never stored — see the
  atomic-claim and enumeration-safe sections above), the replay issues a *fresh*
  instance of that unrecoverable part bound to the *same* resource, rather than
  failing or fabricating the original.
- The true concurrent case (two requests, same key, neither has committed) is
  resolved by the database's unique constraint, not a check-then-act read: let the
  loser's `create` throw a unique-violation, catch it, and fetch the winner's row.
  Anything else is a race.

## Generic, non-oracle service-failure responses

A5's datastore-failure branch is deliberately shaped like every other error response
(`{ error: { code, message } }`, generic message, no stack trace) rather than a raw
500 — for a public, unauthenticated endpoint, even a *distinguishable failure mode*
can become a scripted-attacker signal. Established for enumeration in A3; A5 applies
the same discipline to a create endpoint that has no enumeration surface at all,
because the habit of never leaking implementation detail through error shape is
worth keeping uniform across every public route, not just the ones where the leak
has an obvious exploit today.

## When disclosing "already exists" is fine (established by A6 — Owner Account)

A3's account-enumeration-safe pattern applies to flows keyed on a *guessable or
enumerable* identifier queried against an *existing* account (login, password
reset). It does not automatically extend to every "does X exist" check — A6's
owner-signup form tells the caller directly that an email is already registered
(`email_taken`, 409) rather than hiding behind a generic response. This is a
reasoned exception, not an inconsistency: signup-time "email taken" disclosure is
industry-standard, the information leaked (someone, at some point, registered this
email) is far weaker than what login/reset enumeration would leak (this specific
account currently exists and is reachable right now), and no generic-response
alternative avoids real UX cost (a user stuck unable to tell why signup silently
"succeeded" but they still can't log in). Apply A3's pattern to *lookups against
existing accounts*; use ordinary judgment for *creation-time* uniqueness conflicts.

## Reusable pre-auth tokens must not become standing backdoors

A6 generalizes A4's atomic single-use claim (see above) to a *repeatable* credential:
`OnboardingSession` is deliberately not consumed at A6 because A7-A10 need to reuse
it. The risk this introduces — a long-lived (48h) token that could be replayed after
its step already completed — is closed by making the *replay* response inert rather
than privileged: `already_completed` with no session issued, not a fresh login. Any
future screen that reuses one pre-auth token across multiple steps must make the
same choice explicitly: decide whether a post-completion replay of that token should
ever be able to mint a new authenticated credential, and default to no unless the
architecture states otherwise (see AUTHENTICATION.md's stated scope for each
credential type).

## Resource scope is resolved server-side, never accepted from the client (reaffirmed by A7 — Store Setup)

`POST /api/v1/stores` accepts no `tenantId`, `ownerId`, or `storeId` field at all — the
tenant is resolved from the authenticated session, and authorization is checked against
`session.user.tenantRole`, both server-side. This is the concrete application, at a
store-scoped endpoint, of the rule already stated in TENANT_ROUTING.md ("never trust a
client-provided cluster/site") and DEVELOPMENT_RULES.md ("no backend behavior without
source-of-truth mapping"): the correct pattern for any future screen that mutates a
tenant- or store-scoped resource is the same — resolve scope from the session, and give
the request body nowhere to smuggle a different one in.

## Don't build an adapter with no caller (established by A7 — Store Setup)

When an external integration point (here, ERPNext Warehouse provisioning) genuinely
isn't ready, the honest move is a real, unset state field (`Store.erpnextProvisionStatus
= NOT_PROVISIONED`) plus a documented contract for what will implement it later — not a
speculative adapter interface with a stub implementation nothing calls. An uncalled
adapter reads like integration that exists; it doesn't, and code that looks like it does
is itself a small instance of the "fake success" this architecture is built to prevent.

## Prefer one atomic statement over a conditional claim (established by A8 — Team Invitation)

A4/A6/A7 all fix their races with a conditional `updateMany` as a transaction's first
statement — correct when the row being claimed already exists. A8's case was different:
"supersede any pending invitation for this (tenant, store, email), then create a new
one" had no pre-existing row to claim, so the read-then-write inside a transaction still
raced (two overlapping requests could each see "nothing pending yet" before either
committed, producing two live invitations for the same email+store).

The stronger fix, available whenever the conflict can be expressed as a uniqueness
constraint, is to make the whole thing *one* statement: `@@unique([tenantId, storeId,
email])` plus `upsert` (`INSERT ... ON CONFLICT DO UPDATE`). There is then no window
between the check and the write to race in at all, because there is no separate check.

Order of preference for any "create-or-supersede" operation:
1. A real uniqueness constraint plus a single `upsert` — no window exists.
2. A conditional `updateMany` claim as the transaction's first statement — window
   exists but the database arbitrates it (A4/A6/A7).
3. Read, decide, then write — always a race; never acceptable for security-relevant or
   duplicate-sensitive state.

The tradeoff option 1 makes is that history collapses: one row per key, refreshed in
place, rather than an append-only log of every past attempt. When per-attempt history
genuinely matters, keep it in the audit log (which A8 does) rather than by allowing
duplicate live rows.

## Device credentials are not user credentials (established by A9 - POS Setup)

A POS terminal is a principal of a different kind from a person, and A9 keeps the two apart.

**Two credentials, two lifetimes.** A9 issues a one-time **pairing code** to the human who
configured the terminal: CSPRNG-generated, ~100 bits, Crockford base32 (no look-alike
characters to mis-transcribe), short TTL, stored only as a sha256 hash, displayed exactly
once with an explicit "shown once" warning. `POST /api/v1/pos/devices/activate` consumes it
and issues a separate long-lived **device secret** (256-bit, hashed at rest) to the machine,
never shown to a human. One credential doing both jobs would make the string a merchant reads
off a setup screen the terminal's permanent credential.

**No credential reuse.** Neither is a Session, OnboardingSession, PasswordResetToken,
MfaChallenge or Invitation. A device credential has a different subject, lifetime and
revocation story; only `token.ts`'s hash helper is shared.

**The activation endpoint is unauthenticated by design.** Its caller is a terminal, not a
person. Possession of a pairing code authorizes exactly one narrow action - claim this one
terminal - and confers no user authentication, no tenant authority and no store access. Same
posture as an invitation token above.

**Revocation without data loss.** A compromised terminal is disabled (`disabledAt`), never
deleted, because sales reference `posDeviceId` permanently. Activation refuses a disabled
device even when the pairing code is otherwise valid, so revocation outranks possession.

**Consumption is atomic.** The claim nulls `pairingCodeHash` in the same conditional
`updateMany` that sets `activatedAt`, so a replayed or raced code matches zero rows and the
loser is issued no secret at all. A wrong code and an already-consumed one are
indistinguishable in the response, and every failed attempt feeds a dedicated rate-limit
window (`pos_activate`) so guessing is expensive.

**Device identity is server-assigned.** A browser or hardware fingerprint is never the
database identity of a terminal - fingerprints are forgeable, unstable across reinstalls, and
would silently merge or split terminals.

## An invitation token is an authorization, never an authentication (established by A11)

An invitation link is public, forwardable, and lands in an inbox. What it proves is
"someone at this tenant invited *this email* to *this store* with *this role*". What it
must never come to mean is "whoever holds this URL is that person".

A11 splits the two cases on exactly that line:

- **No account exists for the invited email.** Accepting *is* the account creation: the
  visitor sets their own password and a Session is issued. The token is the only thing
  that could authorize this, and nothing pre-existing is at risk.
- **An account already exists.** The token authorizes joining the store; it authenticates
  nothing. A11 refuses to accept a password here at all, and instead requires a live
  session for that same email. A session belonging to a different email is rejected as
  `identity_mismatch`, so a forwarded link cannot attach someone else's store membership
  to the reader's account.

The decisive reason A11 does not simply verify a password on the existing-account path:
A1's login routes any account with `mfaEnabled` through A2's challenge *before* issuing a
session. A second password check inside A11 would have been a complete MFA bypass for
every existing account with MFA on, reachable by anyone holding the invite link. The cost
is a UX seam ("sign in, then reopen the link"); the alternative — a `next=` redirect
parameter — would have added an open-redirect surface to a public token-bearing URL.
See DECISIONS.md ADR-056/057/058.

Session cookies are set only where a session was genuinely created. Every failure path
(invalid, expired, revoked, already accepted, identity mismatch, disabled, already
member, weak password, rate limited, lost concurrent claim) returns without `Set-Cookie`
— verified by smoke test.
