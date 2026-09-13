# AMBURAX — Tenant Provisioning

Frozen 2026-09-13 (P1-7). Partially implemented: self-serve onboarding (A5–A10) exists;
ERP provisioning does not. This document freezes the full lifecycle so the missing half
lands correctly.

## Lifecycle

```text
New tenant request
  -> control plane: create Tenant record            [IMPLEMENTED]
  -> capability configuration                       [PLANNED]
  -> placement decision (region, cell, ERP tier)    [PLANNED]
  -> ERPNext site provisioning                      [PLANNED]
  -> ERP company configuration                      [PLANNED]
  -> initial admin (owner account)                  [IMPLEMENTED]
  -> stores                                         [IMPLEMENTED]
  -> warehouses (ERP counterpart of a store)        [PLANNED]
  -> POS terminals                                  [IMPLEMENTED]
  -> activation                                     [IMPLEMENTED as onboarding COMPLETE]
```

What exists today is the AMBURAX half, driven by the onboarding state machine
(`OnboardingStep`: `BUSINESS_CREATED → OWNER_CREATED → STORE_CREATED → TEAM_INVITED →
POS_CONFIGURED → COMPLETE`) with a server-derived resume path. What is missing is everything
that touches ERPNext, and `erpnextProvisionStatus` sits at `NOT_PROVISIONED` to say so.

## Frozen rules

### Idempotency

Every step is keyed and replayable:

- Tenant creation is keyed on `Tenant.registrationKey` — already implemented, so a
  double-click or a retried request returns the original tenant instead of creating a second.
- Each onboarding step advance is a conditional `updateMany` that claims the transition, so
  two concurrent requests cannot both advance it. Proven by integration test against real
  PostgreSQL.
- ERP provisioning must be idempotent on `tenantId`: a retry returns the existing site.

### Partial provisioning is the normal case

Provisioning spans two databases and a network. It **will** stop halfway. The frozen posture:

1. State is explicit at every step; there is no "probably finished".
2. A half-provisioned tenant is resumable, not restartable — the resume path reads
   authoritative state and continues (this is exactly what `resume.ts` does for the AMBURAX
   half today).
3. A step that cannot complete leaves a durable record naming the step and the reason.
4. No screen reports a downstream system as ready while its status column says otherwise.
   A10 already enforces this by reporting inventory as `UNAVAILABLE`.

### Failure recovery and compensation

There is no distributed transaction across PostgreSQL and MariaDB (ADR-077), so provisioning
is a saga:

| Failure point | Compensation |
|---|---|
| Tenant created, placement failed | Tenant stays in a pre-active status; retry placement |
| Placement done, ERP site creation failed | Retry with same key; escalate after the attempt ceiling |
| ERP site created, company configuration failed | Reconfigure in place — never create a second site |
| Everything created, activation failed | Retry activation; the tenant is idle, not corrupt |

Compensation prefers **forward recovery** (retry until it completes) over rollback. Deleting
a provisioned ERP site to "undo" is destructive and loses the mapping; leaving it and
retrying converges.

### Status machine

```text
PENDING -> PROVISIONING -> PROVISIONED
                   \-> FAILED -> (retry) -> PROVISIONING
```

`ErpnextProvisionStatus` already models exactly this on both `Tenant` and `Store`. No new
vocabulary is introduced.

## Not built now

The provisioning engine is not implemented in P1-7 and must not be. It depends on the ERP
adapter, which depends on a running ERPNext, which is a P2 decision. What P1-7 fixes is that
when it is built, its state machine, idempotency keys and failure semantics are already
decided rather than improvised under deadline.
