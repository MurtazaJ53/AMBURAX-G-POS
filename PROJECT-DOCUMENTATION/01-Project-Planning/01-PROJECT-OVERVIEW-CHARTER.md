# Project Overview & Project Charter

| Document ID | AMB-CHARTER-001 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | AMBURAX Core Engineering & Product Architecture Team |

---

## 1. Executive Summary & Purpose

AMBURAX G-POS is an enterprise-grade Point of Sale (POS), retail management, and Khata (credit accounting) platform designed specifically for fast-paced retail stores, multi-branch garment outlets, grocery chains, and B2B wholesale counters.

Traditional POS platforms suffer from:
1. High counter friction during peak billing hours (sluggish interfaces requiring mouse clicks instead of keyboard muscle memory).
2. Fragile network dependencies causing billing shutdowns during internet cuts.
3. Disconnected financial records where promotional offers, customer ledger (Udhar), and inventory stock are reconciled manually through error-prone batch runs.

AMBURAX G-POS delivers sub-second counter checkouts, full keyboard-driven operation, automated real-time promotional discount computation, double-entry inventory ledger movements, and a company-scoped customer credit ledger that eliminates dispute risks between merchants and customers.

---

## 2. Business Objectives & Success Metrics

| Strategic Objective | Metric / KPI | Target Goal |
| :--- | :--- | :--- |
| **Ultra-Fast Counter Checkout** | Average Bill Processing Time | < 12 seconds per 10-item transaction |
| **Keyboard Ergonomics** | Shortcut coverage across billing actions | 100% executable without mouse (F1 to F12) |
| **Financial Accuracy** | Discrepancy between POS receipts & ledger | ₹0.00 (Zero variance) |
| **Stock Integrity** | Inventory balance mismatch | 0 negative stock balances; 100% audit trail |
| **Khata Compliance** | Customer credit dispute rate | < 0.01% with SMS OTP verification |
| **Offline Resilience** | Local bill ringing during internet outages | Zero counter downtime |

---

## 3. Target Users & Stakeholders

1. **Cashiers & Front-Desk Staff**: Need ultra-rapid barcode scanning, fast split tender collection (Cash, Card, UPI, Udhar), instant receipt generation, and clear error prompts.
2. **Floor Sales Persons**: Require attribution on sales lines for commissions and performance incentives.
3. **Store Managers**: Oversee cashier opening/closing cash floats, manage price overrides, authorise discounts above cashier thresholds via secure PINs, and handle returns.
4. **Business Owners & Executives**: Monitor consolidated multi-store revenue, real-time gross margins, aged Udhar receivables, and stock reorder requirements across branches.
5. **Accountants & Auditors**: Require tamper-evident audit trails, GST compliance summaries (CGST, SGST, IGST), and seamless synchronization with ERP systems (e.g. ERPNext).

---

## 4. Scope, Boundaries & Constraints

### In-Scope (Phase 1 & Phase 2)
- Fast POS Terminal with hotkeys (`F1` Search, `F2` Barcode, `F3` Customer, `F4` Hold/Recall, `F6` Offers, `F7` Split, `F8` Complete Sale).
- Multi-tier dynamic promotion engine (BOGO, Buy X Get Y, Tiered Value discounts, category-targeted discounts) with single-offer selection and manual toggle.
- Double-entry stock ledger with sellable reservations and stock level projections.
- Company-scoped Khata ledger with mobile OTP verification, credit limits, and support for continuous Udhar extension.
- Multi-store inventory visibility and cross-branch stock transfer workflows.
- Apparel GST calculation engine supporting dual slabs (e.g. 5% under ₹1,000; 12% over ₹1,000).
- Shift management, cash drawer floating, and end-of-day Z-report reconciliation.

### Out-of-Scope (Deferred to Future Milestones)
- Full-fledged manufacturing bill of materials (BOM) — managed in backend ERP.
- Direct automated payroll processing.
- Direct hardware driver manipulation for proprietary legacy RS-232 scales (standard USB/HID scales supported).

---

## 5. Technology Stack Summary

- **Frontend Application**: Next.js 15 (App Router), React 19, Tailwind CSS v4, Lucide Icons, GSAP/Headless primitives.
- **Backend Services**: Next.js Server Components, API Route Handlers, Node.js 20+ LTS, TypeScript 5.5+.
- **Database Layer**: PostgreSQL 16+ via Prisma ORM with strict advisory locking and transactional boundaries.
- **Queue & Outbox**: Transactional Outbox Pattern for guaranteed at-least-once event delivery to downstream consumers.
- **Testing & Tooling**: Playwright E2E suite, Jest/Node test runners, Biome/ESLint linters.
