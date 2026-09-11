# AMBURAX POS — OFFLINE POS ARCHITECTURE & OPERATING PLAN

## 1. Purpose

Amburax POS must be **offline-capable**, but offline mode is not a promise that every feature continues to work without connectivity.

The design goal is:

> Keep safe, frequent store operations running during short network outages while protecting money, stock, customer balances, auditability, and ERPNext consistency.

Offline mode is a controlled degraded operating state.

## 2. Core Principle

```text
ONLINE
  |
  v
Amburax POS
  |
  v
Network Lost
  |
  v
OFFLINE MODE
  |
  +--> Local cached data
  +--> Local transaction queue
  +--> Local command sequencing
  +--> Local validation
  +--> Safe payment workflows
  |
Network Restored
  |
  v
SYNC / RECONCILIATION
  |
  +--> Validate
  +--> Deduplicate
  +--> Replay
  +--> Verify
  +--> Resolve conflicts
  |
  v
ERPNext / authoritative systems
```

## 3. What Offline Mode Is For

Offline mode is primarily for:
- temporary internet outage
- unstable Wi-Fi
- router restart
- store network interruption
- brief ERP/API connectivity failure where local mode is explicitly allowed

Offline mode is not designed to hide a prolonged backend outage indefinitely.

## 4. Modes

### ONLINE
Normal operation.

### DEGRADED
Backend reachable but some dependencies are unavailable.

Example:
- ERPNext slow
- marketplace unavailable
- analytics unavailable

POS may continue only where policy allows.

### OFFLINE
No trusted server connection.

Only explicitly approved offline operations are allowed.

### SYNCING
Connection restored and queued operations are being processed.

### RECONCILIATION REQUIRED
A queued operation cannot be safely replayed automatically and requires staff/manager action.

## 5. Offline Data Cache

The device may cache only the minimum data required for safe operation.

### Cache candidates
- product master
- variant
- SKU
- barcode
- selling price
- MRP
- tax metadata
- store/location configuration
- approved discounts
- customer lookup subset where policy allows
- open shift/session context
- safe operational configuration

### Sensitive data
Customer data must be minimized, encrypted at rest, scoped to tenant/store, and deleted according to retention rules.

Do not cache:
- privileged ERP credentials
- payment secrets
- marketplace access tokens
- AI provider keys
- unrestricted accounting data

## 6. Local Database

Use a transactional local database/storage layer on supported POS devices.

Each local record should include:
- local ID
- tenant ID
- store ID
- device ID
- sequence number
- created timestamp
- sync status
- retry count
- idempotency key
- checksum/version where appropriate

Local data must be encrypted using platform-appropriate secure storage mechanisms.

## 7. Local Transaction Queue

All offline write operations enter a durable local queue.

Example:

```text
Queue
#001 Sale
#002 Sale
#003 Payment
#004 Sale
#005 Return
```

Each operation has:
- command type
- payload
- source document/reference
- idempotency key
- local sequence
- current state
- dependency references
- created time
- retry metadata

### Queue states

```text
PENDING
 -> UPLOADING
 -> ACCEPTED
 -> VERIFIED
```

Failure branches:

```text
RETRYABLE_FAILURE
PERMANENT_FAILURE
CONFLICT
REQUIRES_REVIEW
```

## 8. Idempotency

This is mandatory.

An offline sale must have a deterministic idempotency key generated before the first sync attempt.

Example:

```text
tenant + store + device + local_transaction_id
```

If the same command reaches the server twice:

> exactly one authoritative transaction must be created.

The server returns the original result for a known successful idempotency key where appropriate.

## 9. Device / POS Identity

Every POS terminal/device needs a stable logical identity.

```text
Tenant
 -> Store
 -> POS Terminal
 -> Device
```

The server must know which device created the transaction.

Use this for:
- ordering
- auditing
- reconciliation
- troubleshooting
- duplicate prevention

### Implementation status (A9)

The **device identity** this section requires now exists: `PosDevice` (Tenant -> Store -> POS
Terminal), created and paired at A9, with a stable server-assigned id that offline records and
idempotency keys can reference. `PosDevice.lastSeenAt` is the only runtime column so far and is
written on activation.

Everything else in this document remains unbuilt: no local database, no durable queue, no
sequence numbers, no sync pipeline, no reconciliation workspace, and no ONLINE / DEGRADED /
OFFLINE / SYNCING / RECONCILIATION_REQUIRED mode model. A9 establishes the identity leg only
and makes no claim of offline capability. See DECISIONS.md ADR-061.

## 10. Sequence Numbers

Offline transactions need local ordering.

Maintain a monotonic local sequence per device.

Example:

```text
DEVICE-A
000001
000002
000003
```

Do not use local sequence as the global invoice number unless the backend explicitly guarantees a safe numbering strategy.

Server-side/ERPNext invoice numbering remains authoritative.

## 11. What SHOULD Work Offline

Subject to merchant policy and local regulatory/payment constraints:

### Safe / preferred
- open POS shell
- product search from cached catalog
- barcode scanning
- variant selection
- cart creation
- price display using last trusted configuration
- permitted discounts
- receipt drafting
- queueing eligible sales
- device/session status

### Potentially allowed with policy
- cash sale
- certain device-native payment flows with independently verifiable confirmation
- customer lookup from approved local cache

## 12. What SHOULD NOT Work Offline by Default

- new high-risk discounts
- refunds requiring server confirmation
- large refunds
- unrestricted stock adjustment
- stock reconciliation
- creating new credit/Khata beyond configured offline limits
- permission changes
- user administration
- channel listing changes
- marketplace inventory changes
- purchase approvals
- accounting configuration
- tax configuration
- AI actions that modify ERP records
- destructive operations

## 13. Khata / Credit Offline Policy

Credit is financially sensitive.

Recommended default:

```text
Offline Khata
    |
    +--> disabled
    OR
    +--> strict merchant policy
          |
          +--> approved customer only
          +--> offline credit limit
          +--> transaction limit
          +--> cached due snapshot
          +--> manager approval above threshold
```

Never assume a cached due balance is current.

The UI must clearly say:

> "Balance last confirmed at [time]."

## 14. Stock Offline Policy

Stock is inherently dangerous because other devices/channels may be selling at the same time.

Offline POS may use:

```text
cached_stock
```

only as a local estimate.

Recommended policy:
- allow sales within a configured offline stock-risk rule
- maintain local provisional reservations
- cap offline selling quantity where necessary
- do not claim global stock is confirmed
- reconcile after reconnect

Example:

```text
Last confirmed: 5
Offline sales: 2
Local remaining: 3

Status:
"Local estimate — server confirmation pending"
```

## 15. Payment Policy

Payment must be separated into:

### Confirmed
The payment method/device has independently produced a verifiable confirmation.

### Pending
Payment was attempted but result is unknown.

### Failed
Provider explicitly rejected.

Never convert:

```text
timeout
```

into:

```text
paid
```

For online payment methods requiring server confirmation, the sale may remain pending until verified.

Cash is simpler, but still requires local audit and later reconciliation.

## 16. Offline Sale State Machine

```text
DRAFT
  |
  v
OFFLINE_PENDING
  |
  +--> LOCAL_ACCEPTED
  |
  v
WAITING_FOR_SYNC
  |
  v
UPLOADING
  |
  +--> SERVER_ACCEPTED
  |
  +--> DUPLICATE_RESOLVED
  |
  +--> CONFLICT
  |
  +--> FAILED
  |
  v
ERP_VERIFIED
  |
  v
COMPLETED
```

A POS UI must not show "ERP completed" while the transaction is only locally accepted.

## 17. Receipt Behavior

Offline receipts must clearly identify provisional status when the server has not yet confirmed the transaction.

Example:

> OFFLINE SALE — PENDING SYNC

After successful verification:

> SALE CONFIRMED

If a merchant requires legally valid invoice numbering/printing to occur only after authoritative submission, offline sales must follow that policy.

## 18. Reconnect Detection

The POS should not trust browser network status alone.

When connectivity appears restored:

1. test the Amburax API
2. verify authentication/session
3. test source-of-truth connectivity
4. obtain current server time/version where needed
5. enter SYNCING only after a trusted connection is established

## 19. Sync Pipeline

```text
Local Queue
  |
  v
Connectivity Check
  |
  v
Authenticate
  |
  v
Upload next eligible command
  |
  v
Idempotency check
  |
  v
Server validation
  |
  v
ERPNext transaction
  |
  v
Verify authoritative result
  |
  v
Mark local item synced
  |
  v
Publish events
```

## 20. Sync Ordering

Do not blindly replay commands in arbitrary order.

Respect dependencies.

Example:

```text
Customer created
      ↓
Sale for customer
      ↓
Payment
```

If a command depends on another command, wait for its dependency or use a server-side provisional identity mapping.

## 21. Conflict Types

### Stock conflict
Local sale assumed stock that is no longer available.

### Price conflict
Price changed while device was offline.

### Customer conflict
Customer record changed elsewhere.

### Permission conflict
User lost permission while offline.

### Shift conflict
Shift was closed remotely.

### Duplicate
Same command was already processed.

### Document conflict
Source ERPNext record changed.

## 22. Conflict Resolution Rules

### Safe automatic resolution
- duplicate idempotent command
- retryable network error
- stale cache refresh

### Manual review
- insufficient stock
- large price difference
- unauthorized discount
- credit limit exceeded
- return eligibility conflict
- financial mismatch

Never silently overwrite authoritative data.

## 23. Reconciliation Workspace

After sync, managers should be able to see:

```text
Offline Reconciliation

12 queued
9 synced
2 retrying
1 requires review
```

Example:

```text
OFF-000184
Men's Shirt / M
Qty: 1

Local stock assumption: 1
Server stock: 0

Status: CONFLICT

[Review]
```

## 24. Partial Failure

A batch sync can partially succeed.

Never:
- mark all records as successful
- retry successful operations blindly

Track status individually.

## 25. Sync Retry Policy

Use exponential backoff with a maximum retry strategy.

Example concept:

```text
1st retry  -> short delay
2nd retry  -> longer delay
3rd retry  -> longer delay
...
dead-letter / review
```

Do not create infinite aggressive retries.

## 26. Background Sync

When supported:
- sync automatically when connection is restored
- continue in background
- respect device battery/data policies
- expose progress
- allow manual retry

## 27. Server-Side Reconciliation

The server should reconcile:
- local transaction
- Amburax command
- ERPNext document
- payment result
- stock result
- downstream events

The final state is not accepted until authoritative verification where required.

## 28. Security During Offline Mode

Assume the device may be lost or compromised.

Use:
- device authentication
- encrypted local store
- limited cached data
- automatic session expiration
- remote device revocation
- secure deletion
- tenant/store scoping
- no secrets in local queue

## 29. Printer / Hardware

Offline mode should define behavior for:
- receipt printer
- barcode scanner
- cash drawer
- customer display

Hardware state should never be confused with transaction state.

Example:
Printer failed after payment succeeded:

> Payment/Sale status = COMPLETED
> Printer status = FAILED

Do not retry the entire sale just because printing failed.

## 30. UI Requirements

Show persistent but non-alarming status:

### Online
`● Online`

### Degraded
`● Degraded`

### Offline
`⚠ Offline — 4 sales pending`

### Syncing
`↻ Syncing 4/4`

### Conflict
`! 1 action requires review`

The cashier should know the truth without being overwhelmed.

## 31. Offline Limits

Each merchant can have configurable policies, but the platform must define safe defaults.

Possible limits:
- maximum offline duration
- maximum offline sales count
- maximum offline sales value
- maximum offline cash value
- maximum credit value
- maximum discount
- permitted payment methods
- maximum offline stock risk

When a limit is reached:

> Online connection required to continue this operation.

## 32. Long Outage Behavior

Offline mode is not indefinite.

After a configured threshold:
- restrict sensitive operations
- require manager action
- require reconnection
- keep safe read-only operations if possible

## 33. Offline Analytics

Do not treat local provisional sales as final business analytics.

Dashboards should distinguish:

```text
Confirmed Sales
Pending Offline Sales
```

A manager can see both, but financial reports must use authoritative confirmed records.

## 34. AI During Offline Mode

AI should be restricted.

Allowed:
- cached/basic product assistance
- local UI guidance
- previously downloaded non-sensitive recommendations

Not allowed by default:
- financial actions
- stock transfer
- price changes
- customer-credit decisions
- marketplace changes
- external messaging

AI must not pretend it has live data while offline.

## 35. Mobile vs Desktop

Offline POS is primarily for authorized POS terminals/tablets.

Mobile should have more limited offline behavior unless separately engineered.

## 36. Disaster / Recovery

If the device:
- crashes
- battery dies
- browser closes
- app is reinstalled

the durable local queue must survive where the platform architecture supports it.

If local recovery cannot be guaranteed, the user must be warned before relying on offline operation.

## 37. Testing Requirements

Mandatory scenarios:
1. network loss during cart
2. network loss before payment
3. network loss after payment
4. browser crash with queued sale
5. duplicate sync
6. server timeout after ERP commit
7. payment timeout
8. stale price
9. stale stock
10. credit limit changed remotely
11. permission removed
12. shift closed remotely
13. ERPNext unavailable
14. partial batch sync
15. device restart
16. queue corruption/recovery
17. repeated reconnect/disconnect
18. clock/time mismatch

## 38. Acceptance Criteria

Offline POS is production-ready only when:
- safe offline scope is documented
- local data is encrypted
- durable queue works
- idempotency works
- sync works
- reconciliation works
- conflicts are visible
- duplicate money/stock posting is prevented
- sensitive actions are restricted
- authoritative success is distinguishable from local acceptance
- failure scenarios are tested
- restore/recovery is tested
- operational metrics/alerts exist

## 39. Final Product Rule

Amburax should market the capability as:

> **Offline-capable POS with automatic synchronization and reconciliation**

not:

> **Everything works offline.**

The first is credible. The second is dangerous unless the entire financial/inventory system has been engineered for disconnected operation.
