# AMBURAX POS — API and Event Contracts

## API
/api/v1/auth/*
/api/v1/pos/*   (A9 built the first endpoint under this prefix: POST /pos/devices/activate,
                 which is unauthenticated by design - its caller is a terminal claiming a
                 one-time pairing code, not a person. See SECURITY.md.)
/api/v1/sales/*
/api/v1/inventory/*
/api/v1/catalog/*
/api/v1/customers/*
/api/v1/khata/*
/api/v1/purchasing/*
/api/v1/commerce/*
/api/v1/b2b/*
/api/v1/reports/*
/api/v1/ai/*
/api/v1/admin/*

## Critical commands
create_sale, confirm_payment, create_return, create_exchange, collect_payment, create_transfer, receive_stock, close_shift, connect_channel, publish_listing, update_channel_inventory, ingest_external_order, approve_ai_action.

## Requirements
Authentication, tenant/store context, permission, idempotency, server validation, source verification and audit.

## Events
SaleCompleted, PaymentReceived, StockChanged, TransferCreated, TransferReceived, PurchaseReceived, CustomerDueChanged, OrderReceived, OrderCancelled, ShipmentUpdated, ReturnReceived, ListingPublished, ListingSyncFailed, ReconciliationMismatch, AIActionApproved, AIActionExecuted.

## Webhooks
Validate -> deduplicate -> acknowledge -> enqueue -> process -> audit.
