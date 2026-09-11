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

All of the above are currently **audit log entries, not published domain events**: the durable
outbox of ADR-010 is not built, so nothing downstream reacts to them. Raw pairing codes and
device secrets are never included in any of these records.

## Team / Invitations (A8)
- InvitationCreated
- InvitationResent
- InvitationRevoked
- InvitationAccepted (A11 — recorded as an audit log entry on successful acceptance; the durable
  outbox/event bus of ADR-010 is not built yet, so this is not yet a published domain event)

## AI
- AIRecommendationCreated
- AIApprovalRequested
- AIActionApproved
- AIActionRejected
- AIActionExecuted
- AIActionFailed
- AIActionVerified

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
