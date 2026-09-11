# AMBURAX POS — Final Phase Roadmap

## Phase 0 — Product / Scope / Architecture Lock
Define 125-screen IA, domains, canonical models, tenant/store model, ERPNext ownership, service boundaries, APIs/events, design system.
Exit: no unresolved critical ownership or transaction questions.

## Phase 1 — Foundation + Authentication
Repo/service layout, gateway, auth, registration, onboarding, store selection, roles, permissions, sessions, MFA foundation, audit, CI/CD.
Exit: protected workspace works for real users.

## Phase 2 — ERPNext Adapter + Platform Core
Typed adapter, connection health, reads, transaction commands, retries, idempotency, normalized errors, outbox/events.
Exit: clients use Amburax APIs only.

## Phase 3 — Retail Transaction Core
POS, barcode, variants, cart, customer, tax, discounts, payments, split payment, Khata sale, held bills, history, bill details.
Exit: real sale posts correctly without duplicates.

## Phase 4 — Catalog + Inventory + Procurement
Catalog, variant matrix, barcodes, stock, transfers, GRN, stock take, adjustments, low stock, aging, replenishment, suppliers, purchase orders/receipts.
Exit: stock/procurement reconcile with ERPNext.

## Phase 5 — CRM + Khata + Store Operations
Customer 360, history, segments, loyalty, dues, collections, reminders, staff, attendance, shifts, cash, day close.
Exit: complete daily store loop.

## Phase 6 — Commerce Engine
Channels, accounts, capabilities, schemas, listings, mappings, publish, pricing, allocation, canonical orders, fulfillment/returns abstraction, sync, reconciliation.
Exit: new channel can be added without changing retail core.

## Phase 7 — Shopify
Connection, catalog, inventory, orders, fulfillment, customers, supported returns, reconciliation.
Exit: stable development-store flow.

## Phase 8 — Amazon + Flipkart
Authorization, listings, mapping, pricing, inventory, orders, fulfillment, returns, connector errors, reconciliation, sandbox/staging.
Exit: reliable non-production lifecycle.

## Phase 9 — B2B / IndiaMART
Lead ingestion, qualification, assignment, pipeline, follow-up, quotation, sales order, customer conversion.
Exit: lead-to-order works.

## Phase 10 — Commerce Operations
Sync center, webhooks, jobs, listing errors, external order exceptions, allocation monitor, settlement/reconciliation, profitability, channel performance.
Exit: commerce is supportable in production.

## Phase 11 — Analytics
Retail, commerce, inventory, customer, staff, profitability, store comparison, scheduled reports.
Exit: KPIs have definitions and reconcile.

## Phase 12 — AI Intelligence
Command center, daily brief, sales, inventory, commerce, customer intelligence, anomaly detection.
Exit: grounded AI only.

## Phase 13 — AI Automation
Action drafts, approvals, replenishment, reminders, campaigns, policy engine, safe automations, audit.
Exit: high-risk actions cannot bypass controls.

## Phase 14 — Mobile
Auth, scanner, quick POS, inventory, transfer, receive, customers, Khata, payment collection, alerts, approvals, AI.
Exit: high-value field workflows work.

## Phase 15 — Multi-Store + Enterprise
Central catalog, warehouse, inter-store stock, store permissions, store allocation, consolidated reporting, enterprise administration.
Exit: multiple stores operate safely.

## Phase 16 — Production Hardening
Security, load, resilience, backup/restore, SLOs, runbooks, incident drills.
Exit: production readiness approval.

## Phase 17 — Scale / Further Service Extraction
Split services only when traffic, failure isolation, release cadence, security, or team ownership justifies it.
