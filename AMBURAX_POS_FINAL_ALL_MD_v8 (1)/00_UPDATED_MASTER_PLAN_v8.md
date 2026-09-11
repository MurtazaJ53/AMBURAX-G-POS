# AMBURAX POS — UPDATED MASTER PLAN v8
Date: 2026-09-11

## Current decision
STOP new feature development temporarily. First audit the actual repository and freeze the architecture/compliance boundary.

## Product
AMBURAX POS remains a proprietary SaaS-first retail/commerce platform with:
- premium Web/PWA
- mobile operations
- offline-capable POS
- ERPNext-backed ERP/accounting/stock
- omnichannel commerce
- B2B
- AI intelligence and controlled automation
- multi-tenant SaaS

## Hard boundary
AMBURAX proprietary code:
web, mobile, API, commerce, AI, automation, offline engine, analytics, notifications, tenant/auth platform, ERPNext adapter.

Separate ERPNext side:
Frappe + ERPNext + thin `amburax_erp` customization app.

Never copy ERPNext source/frontend into proprietary AMBURAX packages. Avoid ERPNext core modifications. API separation is an engineering boundary, not a legal guarantee.

## Roadmap
Preserve the original 81-screen retail scope and expanded 125-screen roadmap. A1-A14 remain the authentication foundation, but their implementation status must be verified from the actual repository.

## Gates
1. Repository reality audit.
2. License/SBOM/secrets audit.
3. ERPNext/Frappe version and customization audit.
4. Tenant/data/database architecture audit.
5. Produce architecture gap report.
6. Fix P0 blockers only.
7. Freeze architecture.
8. Resume implementation in dependency order.

## Next implementation order after freeze
Core Retail → Catalog/Inventory → CRM/Khata → Procurement → Store Operations → Pricing/Loyalty → Reports → Commerce → B2B → AI → Administration.

## ERPNext ownership
ERPNext remains authoritative for ERP accounting, GL, stock ledger, ERP stock transactions, purchasing, financial documents and tax/accounting foundations.

AMBURAX owns product UX, orchestration, commerce, AI, automation, offline POS, B2B pipeline and channel-specific platform logic.

## Commercial model
SaaS-first. Customer self-hosted distribution is deferred pending separate distribution/license/legal review.

## Freeze condition
Do not call the architecture frozen until the actual repository audit, exact ERPNext version, dependency/license inventory, tenant/data ownership, DB strategy, security checks and CI validation are evidenced.
