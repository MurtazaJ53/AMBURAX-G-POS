# AMBURAX POS — Microservices Strategy

## Logical service boundaries
Identity, Tenant, Authorization, Audit, Notifications, Search, Files, Realtime, POS/Sales, Returns/Exchange, Catalog, Inventory, Transfers, Procurement, CRM, Khata, Staff/Shift, Pricing/Loyalty, Analytics, Commerce Core, Channel Schema, Listings, Inventory Allocation, Orders/Fulfillment, Reconciliation, Settlements, ERPNext Adapter, Payment Connectors, Messaging Connectors, Marketplace Connectors, E-commerce Connectors, B2B Connectors, AI Gateway, AI Context, AI Recommendation, AI Automation, AI Policy/Evaluation.

## Initial deployment
Do NOT deploy 37 independent services on day one.

Start with:
- identity
- core-retail
- ERPNext-adapter
- commerce-integrations
- analytics
- notifications
- AI

Extract further only when justified by scale, security, failure isolation, workload or team ownership.

## Rules
No cross-service database writes.
Critical commands are idempotent.
APIs/events are versioned.
Long-running work is asynchronous.
Every service has health, metrics, logs, tracing and failure behavior.
