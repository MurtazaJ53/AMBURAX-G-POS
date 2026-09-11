# AMBURAX POS — Screen State Matrix

## Universal states

Every major screen:
1. Initial
2. Loading
3. Loaded
4. Empty
5. Partial data
6. Error
7. Permission denied
8. Session expired
9. Offline/degraded
10. Success
11. Confirmation/destructive state where relevant

## Authentication states
- credentials invalid
- MFA required
- OTP expired
- OTP rate limited
- account locked
- account disabled
- reset token invalid/expired
- reset password weak/mismatched/same-as-current
- invitation expired/revoked
- no store access

## Onboarding states (A5-A10)
- business registration validation error
- business registration duplicate submission (idempotent replay, not an error)
- onboarding session expired
- onboarding step already complete
- registration rate limited
- owner setup email already taken
- owner setup weak password / password mismatch
- owner setup onboarding session missing (client-side — token not found where the
  previous step should have stored it)
- store setup unauthorized (no/expired session)
- store setup forbidden (authenticated but not tenant owner)
- store setup wrong onboarding step (not OWNER_CREATED — already has a store, or earlier)
- store setup code conflict
- store setup rate limited
- ERPNext provisioning not yet available (NOT_PROVISIONED shown honestly, never implied complete)
- invitation invalid role (privilege-escalation attempt blocked)
- invitation invalid store (cross-tenant or unknown store id)
- invitation email unavailable (belongs to another tenant already)
- invitation already-member (existing StoreMembership for that store)
- invitation resend cooldown / invalid state (accepted or revoked)
- invitation revoke on an already-accepted invitation (blocked, not silently ignored)
- team step already complete (Skip/Continue pressed twice, or two tabs)

## POS setup states (A9)
- POS setup unauthorized (no/expired session)
- POS setup forbidden (authenticated, but no POS-configuration capability on that store)
- POS setup store not found (cross-tenant or unknown store id - same response for both)
- POS setup wrong onboarding step (already past POS_CONFIGURED, or too early)
- duplicate terminal code within the store
- POS step skipped (first-class path - a warehouse location has no till)
- terminal created, awaiting pairing (NOT "POS ready")
- pairing code shown once (explicit one-time warning; only a hash is stored)
- pairing code expired before the device claimed it
- pairing code invalid (unknown or already consumed - indistinguishable by design)
- terminal already paired (replay blocked)
- terminal disabled (revoked; a valid pairing code does not override this)
- POS setup / pairing rate limited
- first-POS claimed by a concurrent submit (loser creates no device at all)
- POS setup temporarily unavailable (datastore outage - readable, not a 500)

## Invitation acceptance states (A11)
- invitation link invalid (no such token / malformed)
- invitation link expired
- invitation cancelled (revoked by the business)
- invitation already accepted (terminal — offers sign-in, never re-accepts)
- signed in as the wrong person (identity mismatch — sign out and reopen the link)
- existing account, not signed in (login required — deliberately no password field here)
- account disabled
- already a member of that store
- weak password / password mismatch (new-account path only)
- acceptance rate limited
- invitation claimed by a concurrent acceptance (loser writes nothing at all)
- invitation preview temporarily unavailable (datastore outage — readable, not a 500)

## POS states
- product unavailable
- stale price
- stale stock
- payment pending
- payment failed
- payment confirmed but ERP submission uncertain
- duplicate/idempotency conflict
- ERPNext unavailable
- printer unavailable
- partial payment

## Inventory states
- stock loading
- no stock
- negative/exception state
- reserved
- in transit
- reconciliation mismatch
- adjustment approval required
- ERPNext unavailable

## Commerce states
- disconnected
- connecting
- connected
- token expired
- rate limited
- syncing
- partial sync
- sync failed
- mapping missing
- listing rejected
- webhook delayed
- external order exception
- reconciliation mismatch
- settlement mismatch

## AI states
- insufficient data
- analysis running
- recommendation
- policy blocked
- approval required
- approved
- execution running
- execution failed
- execution verified
- unable to verify

## Rule

Never use a green "success" UI for an action that has not been confirmed by the authoritative system.
