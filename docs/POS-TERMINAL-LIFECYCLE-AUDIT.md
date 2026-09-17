# AMBURAX POS TERMINAL LIFECYCLE AUDIT

## 1. Executive Summary
This document audits the current state of the POS terminal lifecycle in Amburax and provides a blueprint for the implementation of the post-activation lifecycle (disabling, decommissioning, and replacement). The current system correctly provisions and activates devices securely but lacks administrative mutation endpoints for terminal revocation. 

A critical P0 security finding was identified: `saleService.ts` does not check `disabledAt` when resolving an open shift, allowing a disabled terminal to continue ringing sales if a shift was open prior to it being disabled.

## 2. Current Architecture
- **State derivation**: A device has no `status` column. Status is strictly derived from `activatedAt`, `disabledAt`, and `pairingExpiresAt`.
- **Identity**: Devices belong to a `tenantId` and `storeId`. They have a `code` (e.g., POS-01) that is unique per store.
- **Credentials**: Devices are paired via a one-time short-lived `pairingCode`. Upon claim, a long-lived `deviceSecretHash` is stored, and the device is marked with `activatedAt`.
- **Shifts**: `PosSession` tracks a cashier working a till. `PosDevice` holds an `activeSessionId` pointer to enforce exactly one open shift per terminal.

## 3. Actual Current Lifecycle (CURRENT)
- **Creation**: `createFirstPosDevice` (onboarding) or `provisionPosDevice` (post-onboarding) creates the `PosDevice` row, issues a `pairingCode`, and enqueues a `PosDeviceCreated` outbox event. State is `PENDING_ACTIVATION`.
- **Pairing**: The physical terminal submits the pairing code to `activatePosDevice` (unauthenticated). The server validates the hash, checks `disabledAt` and `pairingExpiresAt`, issues a `deviceSecret`, sets `activatedAt`, clears pairing data, and emits a `PosDeviceActivated` audit log. State becomes `ACTIVE`.
- **Usage**: A cashier opens a session (`openPosSession`), which sets `activeSessionId`. Sales refer to the `posSessionId`. The session is closed (`closePosSession`), clearing `activeSessionId`.
- **Revocation**: The `disabledAt` column exists and overrides all other statuses (status becomes `DISABLED`). However, **there is currently no API route or domain service to set this column**.

## 4. State/Transition Table

| State (Derived) | Condition | Transitions To | Trigger |
| --- | --- | --- | --- |
| `PENDING_ACTIVATION` | `!activatedAt && !disabledAt && !expired` | `ACTIVE` | Terminal pairs with code |
| `PENDING_ACTIVATION` | `!activatedAt && !disabledAt && !expired` | `PAIRING_EXPIRED` | TTL expires |
| `PAIRING_EXPIRED` | `!activatedAt && !disabledAt && expired` | `PENDING_ACTIVATION` | Admin regenerates code |
| `ACTIVE` | `activatedAt && !disabledAt` | `DISABLED` | Admin disables terminal |
| `DISABLED` | `disabledAt` | `ACTIVE` (Proposed) | Admin re-enables terminal |

## 5. Security Analysis

| Scenario | CURRENT BEHAVIOR | RISK | RECOMMENDED BEHAVIOR |
| --- | --- | --- | --- |
| **1. Lost terminal** | Remains `ACTIVE` (no disable API). | P1: Unauthorized sales. | Allow admin to disable terminal. |
| **2. Stolen terminal** | Remains `ACTIVE`. | P1: Unauthorized sales. | Allow admin to disable terminal. |
| **3. Disabled terminal** | Core logic rejects it, but no API to disable. | None (if disabled manually). | Implement disable API. |
| **4. Decommissioned terminal**| Cannot decommission. | P2: Stale terminals clutter UI. | Implement disable/decommission. |
| **5. Leaked pairing code** | Code expires soon. Cannot revoke early. | P2: Attacker can pair. | Allow regenerating pairing code, invalidating old. |
| **6. Pairing disabled terminal**| `activatePosDevice` rejects it. | None. | Keep current behavior. |
| **7. Opening shift on disabled**| `openPosSession` rejects it. | None. | Keep current behavior. |
| **8. Sale from disabled terminal**| `resolveSessionForSale` ignores `disabledAt`. | **P0: Sales proceed.** | `resolveSessionForSale` MUST check `disabledAt`. |
| **9. Concurrent device updates**| Unhandled (no update APIs). | None yet. | Implement optimistic concurrency or lock on mutate. |
| **10. Cross-tenant access** | Tenant ID checked everywhere. | None. | Keep current behavior. |
| **11. Cross-store access** | Membership checks storeId. | None. | Keep current behavior. |
| **12. Device replacement** | Must create new, old remains ACTIVE. | P2: Clutter, licensing risk. | Implement replace/decommission. |

## 6. Open Shift Analysis (CURRENT)
- **Terminal has open shift**: `openPosSession` rejects new shift. `activeSessionId` tracks it.
- **Terminal is disabled**: No current API to disable.
- **Admin disables terminal with open shift**: No current API. (PROPOSED: disabling a terminal MUST automatically close any open shift or clear `activeSessionId`).

## 7. Audit/Outbox Analysis
- `PosDeviceCreated` is enqueued to outbox correctly during provisioning.
- `PosDeviceActivated` is written to `AuditLog` but NOT to the outbox. It is in the `OUTBOX_EVENT_TYPES` union, but the activation route fails to enqueue it.
- `PosDeviceDisabled` is in `OUTBOX_EVENT_TYPES` but never emitted (no disable API).

## 8. Tenant/Store Isolation
- **Tenant Isolation**: Verified. `openPosSession`, `closePosSession`, `listPosDevices`, and `createSale` rigorously check `tenantId`. `activatePosDevice` uses a globally unique hash.
- **Store Isolation**: Verified. Cashiers must have the correct `storeMembership` to open a session or sell.

## 9. Concurrency Analysis
- **Disable vs Open Session**: Currently not possible. (PROPOSED: if disable and open session race, disable should null out `activeSessionId`).
- **Disable vs Sale**: (PROPOSED: Sale validation must re-check `disabledAt` so a concurrent disable halts the sale).
- **Pairing vs Disable**: The `updateMany` in `activatePosDevice` expects `disabledAt: null`. A concurrent disable will cause pairing to fail safely.

## 10. Test Data Analysis
- **Finding**: There are ~44 test POS terminals and 16 open shifts in the database.
- **Source**: Older runs of the E2E suite (`apps/web/e2e/terminal.ts`) created new terminals for every test and did not clean up. A helper (`ensureTerminal`) was recently introduced to reuse the `E2E-TILL` terminal, but legacy fixtures remain.
- **Action**: Cleanup is safe as these are in the `demo-retail` tenant. E2E should continue reusing deterministic fixtures. Cleanup should be explicit (out of band SQL truncate/delete) rather than overloading production logic to delete devices (since historical sales depend on them).

## 11. Gap Classification

### P0 (Security/Data-Integrity Blocker)
- **Evidence**: `resolveSessionForSale` (in `posSessionService.ts`) does not check if `PosDevice` is disabled.
- **Current Behavior**: A disabled terminal with an already open shift can continue ringing up sales.
- **Risk**: A stolen terminal disabled by an admin can still process transactions until the shift is closed.
- **Recommendation**: Add `disabledAt` check to `resolveSessionForSale` or explicitly close shift when disabled.
- **Implementation Required Now?**: NO (Audit only).

### P1 (Production Blocker)
- **Evidence**: `disabledAt` exists but cannot be mutated.
- **Current Behavior**: Terminals cannot be revoked.
- **Risk**: Lost or compromised terminals stay active.
- **Recommendation**: Implement `disablePosDevice` API.
- **Implementation Required Now?**: NO.

### P2 (Operational Improvement)
- **Evidence**: `PosDeviceActivated` is written to AuditLog but not enqueued to the Outbox, despite being an `OutboxEventType`.
- **Current Behavior**: Downstream systems cannot react to terminal activation.
- **Risk**: Missing event distribution.
- **Recommendation**: Use a transaction in `activatePosDevice` to enqueue `PosDeviceActivated`.
- **Implementation Required Now?**: NO.

### P3 (Future Enhancement)
- **Evidence**: No way to regenerate a pairing code.
- **Current Behavior**: If pairing code expires, a new terminal must be created.
- **Recommendation**: Implement `regeneratePairingCode`.

## 12. Proposed Lifecycle

### State Transitions
1. **Disable Terminal**
   - **Actor**: `OWNER` or `STAFF` with `RETAIL` capability.
   - **Preconditions**: Terminal exists, belongs to tenant/store.
   - **Side Effects**: Sets `disabledAt = now()`. If an open session exists, close it (sets `closedAt = now()`) and clear `activeSessionId`.
   - **Events**: `PosDeviceDisabled` (Outbox) + AuditLog.
2. **Re-enable Terminal**
   - **Actor**: `OWNER` or `STAFF` with `RETAIL` capability.
   - **Preconditions**: Terminal is disabled.
   - **Side Effects**: Clears `disabledAt`. Nulls `deviceSecretHash` and `activatedAt` to force a re-pair (security best practice for suspended terminals). Issues new pairing code.
   - **Events**: `PosDeviceCreated` (Outbox - to signal pending activation) + AuditLog.

## 13. API Design (PROPOSED)
- `POST /api/v1/pos/terminals/:id/disable`
- `POST /api/v1/pos/terminals/:id/re-pair` (Replaces re-enable to ensure cryptographic safety)

## 14. Authorization (PROPOSED)
- Require `tenantRole` (OWNER/STAFF) + `RETAIL` capability.
- Scoped to `tenantId` and `storeId`.

## 15. Audit/Outbox (PROPOSED)
- `PosDeviceDisabled`: Payload includes `code`, `name`, `storeId`.
- Fix `PosDeviceActivated` outbox emission.

## 16. Test Strategy
- Unit tests for domain logic (`disablePosDevice`, `repairPosDevice`).
- Integration tests ensuring `resolveSessionForSale` correctly rejects sales from disabled terminals.

## 17. Implementation Phases
- **T1**: Fix P0 `resolveSessionForSale` missing check.
- **T2**: Fix P2 `activatePosDevice` missing outbox event.
- **T3**: Implement `disablePosDevice` domain service and API route.
- **T4**: Implement `repairPosDevice` (regenerate pairing code) domain service and API.
- **T5**: Admin UI integration for revocation.

## 18. Risks
- **Data Integrity**: Deleting devices instead of disabling them would orphan `Sale` records. We strictly enforce `disabledAt`.
- **Concurrency**: Disabling a terminal while a sale is in-flight. The database transaction in `createSale` must observe `disabledAt` inside the transaction boundary if strict serialization is required.

## 19. Non-Goals
- We do NOT introduce a separate `DECOMMISSIONED` state. `DISABLED` is sufficient for revocation.
- We do NOT introduce a hard-delete.
- We do NOT touch ERPNext or authentication boundaries.
