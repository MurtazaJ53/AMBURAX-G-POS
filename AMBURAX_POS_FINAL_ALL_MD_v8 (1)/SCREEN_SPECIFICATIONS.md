# AMBURAX POS — Screen Specifications

## Purpose
Define the functional contract behind every UI screen so visual design, frontend implementation, backend APIs, ERPNext mapping, permissions, state handling and testing stay aligned.

## Required specification template

For every screen record:
- Screen ID / name
- Route
- Purpose
- User roles
- Tenant/store scope
- Primary actions
- Secondary actions
- Components
- API endpoints
- Backend service owner
- ERPNext mapping
- Events produced/consumed
- Validation rules
- Loading/empty/error/permission states
- Audit requirements
- Security requirements
- Analytics/telemetry
- E2E test cases

## A1 — Login

Route: `/auth/login`
Owner: Identity
APIs: `POST /api/v1/auth/login`
Permissions: Public
Flow: credentials -> session or MFA challenge -> tenant/store resolution.
States: invalid credentials, rate limit, locked account, disabled account, network failure, ERPNext unavailable only if post-login ERP lookup is needed.
Security: rate limiting, secure session creation, no credential logging, generic error messaging.

## A2 — Verification / OTP / MFA

Route: `/auth/verify`
Owner: Identity
APIs: `POST /api/v1/auth/verify`, `POST /api/v1/auth/resend`
Purpose: verify login challenge or step-up authentication.
Security: attempt limits, expiration, replay prevention.

## A3 — Forgot Password

Route: `/auth/forgot-password`
Owner: Identity
API: `POST /api/v1/auth/password/reset-request`
Important rule: always return a privacy-safe response without revealing account existence.

## A4 — Reset Password

Route: `/auth/reset-password`
Owner: Identity
API: `POST /api/v1/auth/password/reset`
Validation: token validity, password policy, confirmation.
Side effect: revoke appropriate prior sessions according to security policy.

## A5 — Business Registration

Route: `/onboarding/business`
Owner: Tenant
APIs: `POST /api/v1/tenants`, `POST /api/v1/tenants/verify`
Creates the business/workspace context; does not create ERP transactions.

## A6 — Owner Account

Route: `/onboarding/owner`
Owner: Identity/Tenant
API: `POST /api/v1/onboarding/owner`
Creates owner identity linked to tenant.

## A7 — Store Setup

Route: `/onboarding/store`
Owner: Tenant
API: `POST /api/v1/stores`
Maps store to configured ERPNext warehouse/company structure.

## A8 — Team Invitation

Route: `/onboarding/team`
Owner: Identity/Tenant
APIs: `GET/POST /api/v1/invitations`, `DELETE /api/v1/invitations/:id`, `POST /api/v1/invitations/:id/resend`, `POST /api/v1/onboarding/team/complete`
Requires owner/admin permissions (`tenantRole: OWNER`; enforced server-side, never from the request body).
Scope: an invitation targets exactly one Store with exactly one allow-listed role (never OWNER — see PERMISSIONS.md's "invitable roles").
Onboarding: `POST /onboarding/team/complete` owns the STORE_CREATED → TEAM_INVITED transition and is separate from creating invitations — the step completes with zero invitations (Skip). See DECISIONS.md ADR-053.
A11 dependency: A8 persists the authoritative invitation state (tenant, store, role, token hash, expiry, accept/revoke timestamps); `resolveInvitation()` is the shared validation service A11 consumes.

## A9 — POS Setup

Route: `/onboarding/pos`
Owner: Retail
APIs: `POST /api/v1/onboarding/pos` (create the first terminal, or `{ skip: true }`),
`POST /api/v1/pos/devices/activate` (the terminal claims its pairing code)

Creates the store's first **POS terminal** as its own entity (`PosDevice`) - never a Store,
never a User, never a warehouse. One store may hold many terminals; A9 creates the first.

Scope of configuration: terminal name + code, receipt header/footer, and counter behaviour
(product images, scan sound, cash drawer). Deliberately **excludes** invoice prefix / start
number / default customer / price list - numbering is ERPNext-authoritative and the other two
are ERPNext-owned records nothing here can validate yet. Those belong to screen 74 (POS
Configuration). See DECISIONS.md ADR-063.

Two states, not one: creating the terminal yields `PENDING_ACTIVATION` and a one-time pairing
code. The terminal becomes `ACTIVE` only when a real device claims that code. A9 never reports
a configured row as a working POS. See ADR-062/065.

Onboarding: A9 owns `STORE_CREATED | TEAM_INVITED -> POS_CONFIGURED`. Both predecessors are
accepted because A8's Skip is a supported path (ADR-067). Skip is first-class here too - a
warehouse location has no till.

Permissions: tenant OWNER, or a `StoreMembership` on that store with role OWNER/STORE_MANAGER
(ADR-068). Skipping the step is owner-only.

## A10 — Onboarding Complete

Route: `/onboarding/complete`
Owner: Onboarding
Purpose: summarize setup readiness and enter app.
Must not claim inventory/payment/channel readiness unless verified.

## A11 — Staff Invitation Acceptance

Route: `/invite/:token`
Owner: Identity
API: `POST /api/v1/invitations/accept` (token in the request body — see SCREEN_API_MATRIX.md for why this deviates from the matrix's original `/invitations/:id/accept`)
Flow: validate invite -> create/attach identity -> accept store/role membership.

Preview: the page resolves the token server-side via `previewInvitation()` and renders only display
names (tenant, store, role, invited email) — never internal ids. Invalid / expired / revoked /
already-accepted are terminal, readable dead ends; a datastore outage degrades to "Temporarily
unavailable", not a 500.

New account (no `User` for the invited email): the visitor sets name + password, a `User` is created
with `tenantRole = STAFF` (never OWNER), the `StoreMembership` is created with the invitation's role,
and a Session is issued — this path is itself the account creation, so it is the only path that logs
the visitor in.

Existing account: A11 **never** verifies a password. Acceptance requires an already-authenticated
session whose email equals the invitation email; otherwise `login_required` ("sign in, then reopen
this link"). A session for a *different* email is `identity_mismatch`. See DECISIONS.md ADR-056/057/058
— a second password path here would have silently bypassed A2's MFA challenge.

Role: re-validated against `INVITABLE_STORE_ROLES` at acceptance time, not only at creation (ADR-060).
Onboarding: A11 does not read or advance `Tenant.onboardingStep` — accepting an invitation is not an
onboarding step and must never move the owner's setup state machine.
Membership: exactly one `StoreMembership` per (user, store); an existing one returns `already_member`.

## A12 — Store / Workspace Selection

Route: `/select-store`
Owner: Tenant/Authorization
API: `GET /api/v1/stores/available`
The selected store becomes the active permission/data context.

## A13 — Security Settings

Route: `/settings/security`
Owner: Identity/Security
APIs: MFA management, password change, session revoke, login history.

## A14 — Sessions / Devices

Route: `/settings/security/sessions`
Owner: Identity
APIs: list/revoke sessions.
Must not expose unnecessary secrets; IP/device information should follow privacy policy.

## Existing retail screens

For B15 onward use the same contract structure. Example:
- POS: POS/Sales service -> ERPNext Sales Invoice/Payment Entry.
- Inventory: Inventory service -> ERPNext stock/warehouse records.
- Catalog: Catalog service -> ERPNext Item/Item Variant.
- Customers: CRM service -> ERPNext Customer.
- Khata: Khata service -> ERPNext receivable/payment records.
- Commerce: Commerce service -> channel adapter -> external platform.
- AI: AI service -> typed tools -> domain services -> approval/policy -> execution.
