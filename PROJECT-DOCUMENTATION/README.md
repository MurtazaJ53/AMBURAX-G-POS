# AMBURAX G-POS — Master Documentation Index

| Metadata | Details |
| :--- | :--- |
| **System Name** | AMBURAX G-POS (Enterprise Retail & Khata POS) |
| **Document Version** | 1.0.0-PROD |
| **Date** | 2026-10-19 |
| **Status** | Production Ready / Fully Documented |
| **Target Audience** | Developers, DevOps, QA, Product Managers, Store Owners, Auditors |

---

## Executive Summary

AMBURAX G-POS is an offline-resilient, multi-tenant, enterprise Point of Sale (POS) and inventory platform engineered specifically for modern retail, garment, grocery, and multi-store businesses in India and global markets. It combines lightning-fast counter billing (F-key shortcuts, scanner integration, split tenders), real-time double-entry stock movement tracking, automated multi-tier promotional pricing, customer loyalty programs, multi-store inventory routing, and an authoritative B2B/B2C credit ledger (Khata).

---

## Master Documentation Directory Structure

```text
PROJECT-DOCUMENTATION/
├── 01-Project-Planning/
│   ├── 01-PROJECT-OVERVIEW-CHARTER.md
│   ├── 02-BUSINESS-REQUIREMENTS-DOCUMENT-BRD.md
│   ├── 03-SOFTWARE-REQUIREMENTS-SPECIFICATION-SRS.md
│   └── 04-ROADMAP-AND-SCOPE.md
├── 02-UI-UX-Design/
│   ├── 01-DESIGN-SYSTEM-AND-TOKENS.md
│   ├── 02-SCREEN-INVENTORY-AND-FLOWS.md
│   └── 03-ACCESSIBILITY-AND-KEYBOARD-WORKFLOWS.md
├── 03-Architecture/
│   ├── 01-SYSTEM-ARCHITECTURE.md
│   ├── 02-ARCHITECTURE-DECISION-RECORDS-ADR.md
│   ├── 03-DATA-FLOW-AND-STATE-DIAGRAMS.md
│   └── 04-CELL-AND-MULTI-TENANT-ISOLATION.md
├── 04-Database/
│   ├── 01-DATABASE-SCHEMA-AND-ERD.md
│   ├── 02-DATA-DICTIONARY-AND-CONSTRAINTS.md
│   └── 03-MIGRATION-AND-RECONCILIATION-POLICIES.md
├── 05-API-Integrations/
│   ├── 01-API-SPECIFICATION-AND-ENDPOINTS.md
│   ├── 02-WEBHOOKS-AND-OUTBOX-EVENTS.md
│   └── 03-EXTERNAL-INTEGRATIONS-ERP-SMS-PAYMENTS.md
├── 06-Modules-Features/
│   ├── 01-POS-BILLING-CHECKOUT.md
│   ├── 02-PROMOTIONS-OFFERS-ENGINE.md
│   ├── 03-INVENTORY-AND-STOCK-LEDGER.md
│   ├── 04-KHATA-CUSTOMER-CREDIT-LEDGER.md
│   ├── 05-SHIFTS-CASH-DRAWER-RECONCILIATION.md
│   └── 06-PURCHASES-SUPPLIERS-RECEIVING.md
├── 07-Security-Compliance/
│   ├── 01-RBAC-AND-SECURITY-POLICY.md
│   ├── 02-GST-TAXATION-AND-AUDIT-COMPLIANCE.md
│   └── 03-THREAT-MODEL-AND-DATA-PROTECTION.md
├── 08-Testing-QA/
│   ├── 01-TEST-STRATEGY-AND-MATRIX.md
│   ├── 02-TEST-CASES-AND-E2E-SUITE.md
│   └── 03-UAT-SIGN-OFF-AND-PERFORMANCE-BENCHMARKS.md
├── 09-Deployment-DevOps/
│   ├── 01-LOCAL-DEVELOPMENT-SETUP.md
│   ├── 02-PRODUCTION-DEPLOYMENT-GUIDE.md
│   └── 03-DISASTER-RECOVERY-AND-BACKUP-SOP.md
├── 10-User-Admin-Guides/
│   ├── 01-CASHIER-OPERATIONS-MANUAL.md
│   ├── 02-STORE-MANAGER-ADMIN-GUIDE.md
│   └── 03-TROUBLESHOOTING-AND-INCIDENT-SOP.md
├── 11-Releases-Maintenance/
│   ├── 01-CHANGELOG-AND-VERSION-HISTORY.md
│   ├── 02-TECHNICAL-DEBT-AND-MAINTENANCE-SCHEDULE.md
│   └── 03-HANDOVER-CHECKLIST.md
├── 12-Legal-Handover/
│   ├── 01-IP-AND-SOFTWARE-OWNERSHIP.md
│   └── 02-THIRD-PARTY-LICENSES-AND-AUDIT.md
└── 13-POS-Specific-Specs/
    ├── 01-PAYMENT-LIFECYCLE-AND-ROUNDING.md
    ├── 02-OFFLINE-SYNC-AND-CONFLICT-RESOLUTION.md
    └── 03-HARDWARE-COMPATIBILITY-SPEC.md
```

---

## Quick Navigation by Role

- **For New Developers**: Start with [01-LOCAL-DEVELOPMENT-SETUP.md](file:///d:/amburax-projects/G-POS/PROJECT-DOCUMENTATION/09-Deployment-DevOps/01-LOCAL-DEVELOPMENT-SETUP.md) and [01-SYSTEM-ARCHITECTURE.md](file:///d:/amburax-projects/G-POS/PROJECT-DOCUMENTATION/03-Architecture/01-SYSTEM-ARCHITECTURE.md).
- **For Cashiers & Operators**: Refer to [01-CASHIER-OPERATIONS-MANUAL.md](file:///d:/amburax-projects/G-POS/PROJECT-DOCUMENTATION/10-User-Admin-Guides/01-CASHIER-OPERATIONS-MANUAL.md).
- **For Store Managers**: Read [02-STORE-MANAGER-ADMIN-GUIDE.md](file:///d:/amburax-projects/G-POS/PROJECT-DOCUMENTATION/10-User-Admin-Guides/02-STORE-MANAGER-ADMIN-GUIDE.md).
- **For QA & Testers**: Use [01-TEST-STRATEGY-AND-MATRIX.md](file:///d:/amburax-projects/G-POS/PROJECT-DOCUMENTATION/08-Testing-QA/01-TEST-STRATEGY-AND-MATRIX.md) and [02-TEST-CASES-AND-E2E-SUITE.md](file:///d:/amburax-projects/G-POS/PROJECT-DOCUMENTATION/08-Testing-QA/02-TEST-CASES-AND-E2E-SUITE.md).
- **For DevOps & SysAdmins**: Refer to [02-PRODUCTION-DEPLOYMENT-GUIDE.md](file:///d:/amburax-projects/G-POS/PROJECT-DOCUMENTATION/09-Deployment-DevOps/02-PRODUCTION-DEPLOYMENT-GUIDE.md) and [03-DISASTER-RECOVERY-AND-BACKUP-SOP.md](file:///d:/amburax-projects/G-POS/PROJECT-DOCUMENTATION/09-Deployment-DevOps/03-DISASTER-RECOVERY-AND-BACKUP-SOP.md).
