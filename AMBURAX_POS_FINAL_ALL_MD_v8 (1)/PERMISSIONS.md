# AMBURAX POS — Permission Model

> **Implementation status, recorded 2026-09-13 (P1-7 freeze).** Everything below is the
> *target* model and is frozen as such (ADR-092). What exists in code today is a deliberate
> subset, and the difference matters when reading this file:
>
> | Target | Implemented today |
> |---|---|
> | `resource.action` permissions | None. No permission or role table exists. |
> | Named roles with permission sets | Three hardcoded allowlists: `SELLING_STORE_ROLES`, `POS_CONFIGURABLE_STORE_ROLES`, `INVITABLE_STORE_ROLES` |
> | Role assignment | `StoreMembership.role`, a free-form `String` column |
> | Tenant-level role | `User.tenantRole` — `OWNER` or `STAFF` |
> | Approval limits | Not implemented |
> | Teams | Not implemented |
> | Warehouse scope | Not implemented (no warehouse entity) |
>
> The evaluation order is frozen and is honoured by the current code:
> authenticate → resolve tenant → resolve capability → resolve role → evaluate permission →
> evaluate resource scope → execute. AI and API automation must traverse the same path.
> The allowlists are to be **replaced** by the model below, not extended.

## Permission format

`resource.action`

Examples:
- pos.create
- pos.refund
- catalog.read
- catalog.edit
- inventory.read
- inventory.adjust
- transfer.create
- transfer.approve
- khata.read
- khata.collect
- purchase.create
- purchase.approve
- user.invite
- role.manage
- commerce.connect
- commerce.publish
- commerce.price
- commerce.allocate
- commerce.reconcile
- ai.view
- ai.approve
- ai.execute

## Context

Every permission decision is evaluated against:
- user
- tenant
- store
- role
- resource
- action
- approval limit

## Example roles

### Cashier
POS sales, customer lookup, payment collection, limited discount.

### Sales Associate
POS + customer management + limited discount.

### Store Manager
Cashier abilities + returns + stock operations + transfers + day close + approvals within limit.

### Inventory Manager
Catalog/inventory/GRN/transfer/stock-take permissions.

### Accountant
Financial/reporting/receivable permissions, no uncontrolled stock edits.

### Owner/Admin
Tenant-wide administration subject to platform safeguards.

## Tenant-level vs store-level role (established by A6)

`User.tenantRole` (OWNER/STAFF) is a different axis from `StoreMembership.role`
(Cashier/Manager/etc., established per store). A tenant has exactly one OWNER —
set once, at A6, for the tenant's first user — and it answers "is this user
allowed to administer the business itself," independent of which stores they can
operate in day to day. It is not a join table because `User.tenantId` is already
a hard 1:1 relationship; see DECISIONS.md ADR-041.

A7 (Store Setup) is the first screen to actually create a `StoreMembership` row: the
owner gets `role: 'OWNER'` on their own first store. `tenantRole: 'OWNER'` does not
automatically grant store access by itself — the explicit `StoreMembership` row is what
A12 (Store/Workspace Selection) and all future store-scoped screens check. This keeps
tenant-wide administrative authority and per-store operational access as genuinely
separate, independently queryable facts, exactly as multi-store access requires: an
owner could in principle have `StoreMembership` on some stores and not others once a
tenant has more than one.

## Invitable roles (established by A8)

A8 (Team Invitation) restricts what role an invitation can grant to
`src/server/tenant/storeRoles.ts`'s `INVITABLE_STORE_ROLES` allow-list: Store Manager,
Sales Associate, Cashier, Inventory Manager, Accountant — the same named roles this
document already lists, minus Owner/Admin. `OWNER` can never be requested through an
invitation payload; it is set exactly once, at A6, for the tenant's first user (see
DECISIONS.md ADR-041). Only `tenantRole: 'OWNER'` may create, resend, or revoke
invitations — "Requires owner/admin permissions" per SCREEN_SPECIFICATIONS.md, mapped
to the only tenant-level admin role that currently exists.

A11 (Staff Invitation Acceptance) re-checks the same allow-list at *acceptance* time
against the invitation's stored `role`, rather than trusting that A8 validated it when
the row was written (DECISIONS.md ADR-060). Two reasons: the allow-list can change
between issuance and acceptance, and an invitation row altered by any future code path
must not be able to grant a role the allow-list no longer permits. The accepting user's
`tenantRole` is hard-coded to `STAFF` on the new-account path and left untouched on the
existing-account path — an invitation can never write `tenantRole` at all, so it cannot
create or promote an OWNER. The two authorization axes stay distinct: `User.tenantRole`
(OWNER/STAFF, tenant-wide) and `StoreMembership.role` (per store); A11 only ever writes
the latter, and only for the single store named on the invitation.

## POS configuration capability (established by A9)

Configuring a POS terminal is authorized by a **store-scoped capability**, not by tenant
ownership alone. `src/server/pos/posRoles.ts` defines `POS_CONFIGURABLE_STORE_ROLES`
(OWNER, STORE_MANAGER) and `canConfigurePos`, which admits a caller when **both** hold:

1. the target store belongs to the caller's own tenant - a role string means nothing across
   a tenant boundary, so cross-tenant is refused before any role is consulted; and
2. the caller is either a tenant OWNER (who owns every store in the tenant by definition, and
   so needs no membership row), or holds a `StoreMembership` **on that exact store** with a
   role in the allow-list.

Requirement 2 is what blocks "has access to Store A, registers a terminal under Store B": a
STAFF user gets no ownership shortcut and a membership elsewhere is irrelevant. A CASHIER
membership deliberately does not qualify - operating a till is not configuring one.

This is a second allow-list rather than a reuse of `INVITABLE_STORE_ROLES`, which answers a
different question ("what role may an invitation grant"). Merging them would mean widening
who can be invited in order to widen who can configure a till. See DECISIONS.md ADR-068.

Skipping the POS onboarding step stays `tenantRole: 'OWNER'`-only: that is a tenant-level
onboarding decision, not a store operation.

A POS device holds **no role at all**. `PosDevice` is not a principal in this permission
model - it never authenticates as a User and never inherits one's role. Cashier identity and
terminal identity are separate dimensions, and a future sale will carry both.

## Important

Frontend permission checks only control UX. Server-side authorization is mandatory.

## AI

An AI action inherits the initiating user's tenant/store context and permissions; AI cannot elevate privileges.
