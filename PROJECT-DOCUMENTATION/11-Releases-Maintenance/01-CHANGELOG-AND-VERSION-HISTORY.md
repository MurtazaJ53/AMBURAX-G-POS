# Release Notes & Version History

| Document ID | AMB-REL-001 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Release Engineering Team |

---

## 1. Release v1.0.0 (October 19, 2026) — GA Production Release

### Summary of Major Deliverables
- **In-Terminal F6 Offer Management**: Cashiers and managers can now view, select, start/stop, and add offers directly within the POS checkout modal without navigating away.
- **Single-Offer Mode Enforcement**: Enforces a single best offer per transaction by default to protect retailer gross margins, with a clear toggle to uncheck offers on demand.
- **Continuous Multi-Bill Udhar Extension**: Relaxed the blocking overdue check (`overdue_balance_exists`) so merchants can ring up subsequent Udhar bills for regular customers without requiring old balances to be settled first.
- **Pure Udhar Checkout Reconciliation**: Resolved tender mismatch errors when promotional discounts are applied on ₹0 down-payment Udhar sales.
- **Comprehensive Lifecycle Documentation Suite**: Delivered the complete 13-category master documentation package covering planning, UI/UX, architecture, database, APIs, modules, security, QA, DevOps, user guides, releases, legal handover, and POS hardware specifications.

---

## 2. Release v0.9.0 (October 08, 2026) — Beta Milestone

- Introduced dual-slab Apparel GST tax calculator (5% under ₹1,000; 12% over ₹1,000).
- Implemented customer mobile SMS OTP authentication for Khata accounts.
- Added hold and recall functionality (`F4`) for multi-cart counter management.
