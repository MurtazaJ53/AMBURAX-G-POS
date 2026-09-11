# AMBURAX POS — Authentication / Authorization

## Screens
Login, Verification, Forgot Password, Reset Password, Business Registration, Owner Setup, Store Setup, Team Invitation, POS Setup, Complete Onboarding, Staff Invitation Acceptance, Security, Store Selection, Sessions/Devices.

## Authorization
```text
User -> Tenant -> Store -> Role -> Permission -> Approval Limit
```

## Security
Server-side authorization is mandatory.
Protect refunds, high discounts, credit, stock changes, transfers, purchase approvals, day-close changes, role changes, accounting actions and high-risk AI actions.

## Sessions
Expiry, revocation, device list, sign-out-all, login history, MFA and optional step-up auth.

## Pre-auth credential types

Not every opaque token in this system is a Session, and none of the others should be
treated as one:
- **Session** — a real, authenticated User's access. Created at A1 (no MFA), A2 (MFA
  completion), or A6 (owner account creation — standard signup UX; see DECISIONS.md
  ADR-043). Never at A4 (reset) or A5 (registration).
- **MfaChallenge token** (A2) — proves "password was correct for this User," not yet
  "signed in."
- **PasswordResetToken** (A3/A4) — proves "controls this email inbox," authorizes
  exactly one password change, grants no application access.
- **OnboardingSession** (A5) — proves "started this tenant's registration," tenant-
  scoped rather than user-scoped because no User exists yet. Grants no application
  access; only lets A6-A10 continue that one tenant's setup. Distinct from all of the
  above because it is the only credential issued before any User row exists at all.
  Not consumed at A6 (unlike PasswordResetToken at A4) — it stays valid for A7-A10,
  which reuse the same token; the one-time gate for A6 specifically is
  `Tenant.onboardingStep`, not this token. A retry after the owner already exists
  gets a safe "already completed" response, not a fresh session — see DECISIONS.md
  ADR-042 for why re-arming a login session on every replay would exceed this
  credential's stated scope.
- **POS pairing code** (A9) - proves "the person who configured this terminal handed you this
  code," nothing more. One-time, short-lived, hashed at rest, shown to a human exactly once and
  unrecoverable afterwards. Consumed by `POST /api/v1/pos/devices/activate`, which issues a
  separate long-lived **device secret** (256-bit, hashed) to the machine. Neither is a user
  credential: a POS device never authenticates as a User, never holds a role, and possession of
  either grants no application access to any person. Revocation is `PosDevice.disabledAt` and
  outranks possession of a valid code. See DECISIONS.md ADR-065/066 and SECURITY.md's "device
  credentials are not user credentials".
- **Invitation token** (A8/A11) — proves "the tenant's owner invited this specific
  email to this specific store with this specific role," nothing more. Not consumed
  at creation, resend, or revoke — only A11's acceptance transaction consumes it,
  using the same atomic-claim shape as A4's token race fix (ADR-031): the claiming
  `updateMany` is the transaction's first statement, so a concurrent second acceptance
  blocks, then fails having written no user, no membership and no session.
  One row per (tenant, store, email) — see DECISIONS.md ADR-054 for why.
  Possession of this token authenticates **nobody**. It authorizes creating a brand-new
  account for the exact invited email (which is itself account creation, so a session is
  issued there), and nothing else. For an email that already has an account, the token
  grants no authentication whatsoever: acceptance requires a live session for that same
  email, obtained through A1/A2 in the normal way, MFA included. A11 therefore adds no
  second password-verification path anywhere in the system — see ADR-056/057/058.
