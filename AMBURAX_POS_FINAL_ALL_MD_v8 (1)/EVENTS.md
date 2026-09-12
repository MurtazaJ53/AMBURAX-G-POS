# AMBURAX POS — Event Catalog

## Transaction events
- SaleCompleted
- PaymentReceived
- ReturnCompleted
- ExchangeCompleted
- ShiftClosed
- DayCloseCompleted

## Inventory
- StockChanged
- StockAdjusted
- TransferCreated
- TransferApproved
- TransferReceived
- StockTakeCompleted
- ReplenishmentRecommended

## Purchasing
- PurchaseOrderCreated
- PurchaseReceived
- SupplierUpdated

## Customer / Khata
- CustomerCreated
- CustomerUpdated
- CustomerDueChanged
- CustomerPaymentReceived
- CustomerSegmentChanged

## Commerce
- ChannelConnected
- ChannelDisconnected
- ListingPublished
- ListingSyncFailed
- InventorySyncCompleted
- ExternalOrderReceived
- ExternalOrderCancelled
- ShipmentUpdated
- ExternalReturnReceived
- SettlementImported
- ReconciliationMismatch

## B2B
- LeadCreated
- LeadAssigned
- QuotationCreated
- SalesOrderCreated

## POS devices (A9)
- PosDeviceCreated
- PosDevicePairingCodeIssued
- PosDeviceActivated
- PosDeviceDisabled (not yet emitted - no revoke screen exists; the model supports it via
  `disabledAt`)

`PosDeviceCreated` is emitted through the durable outbox (ADR-070): the event row is
INSERTed by the same PostgreSQL transaction that creates the device, so it exists if and
only if the device does. The rest are still audit-log entries only, and migrate to the
outbox as each producer is wired.

Raw pairing codes and device secrets are never included in any of these records, in the
audit log or in an event payload — an outbox row is replayable and readable by every
future consumer.

**What "published" means today:** the outbox is real (durable, transactional, retried,
dead-lettered), but no message transport is connected. Delivery goes through the
`OutboxPublisher` interface whose only implementation is a disclosed development stand-in.
Nothing downstream consumes anything yet, because nothing downstream exists.

## Team / Invitations (A8)
- InvitationCreated
- InvitationResent
- InvitationRevoked
- InvitationAccepted (A11 — recorded as an audit log entry on successful acceptance. The
  outbox now exists and `InvitationAccepted` is a declared event type, but this producer is
  not wired yet; it moves to the outbox when A11's acceptance transaction is revisited.)

## AI
- AIRecommendationCreated
- AIApprovalRequested
- AIActionApproved
- AIActionRejected
- AIActionExecuted
- AIActionFailed
- AIActionVerified

## Outbox mechanics (ADR-070)

- **Transactional insert.** `enqueueOutboxEvent(tx, …)` accepts a `Prisma.TransactionClient`
  and nothing else, so an event cannot be written outside the transaction that produced the
  fact. This is the difference between `outbox_events` and `AuditLog`, which deliberately
  writes on the global client and survives a rollback.
- **Idempotency.** A deterministic `idempotencyKey` — `tenant:eventType:entity:discriminator`
  — is unique-indexed, so a retried operation collides rather than enqueuing a duplicate.
- **Tenant isolation.** `tenantId` is required and FK-enforced; the dispatcher accepts an
  optional `tenantId` that scopes the claim, and a per-tenant dispatcher can never observe
  another tenant's events.
- **Claiming.** `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` in one statement.
  Several dispatchers run safely in parallel; there is no select-then-claim window.
- **Retry.** Exponential backoff from 30 s, capped at 1 h, applied by the claim itself so a
  crashed dispatcher cannot hot-loop. Dead-lettered after 8 attempts.
- **Delivery is at-least-once.** Exactly-once across a database and a separate transport is
  not achievable without distributed transactions, which is precisely why the requirement
  below exists.

## Event requirements

Every business event should carry:
- event_id
- event_type
- event_version
- occurred_at
- tenant_id
- store_id when relevant
- actor/source
- correlation_id
- causation_id
- entity_id
- payload version

Consumers must be idempotent.
