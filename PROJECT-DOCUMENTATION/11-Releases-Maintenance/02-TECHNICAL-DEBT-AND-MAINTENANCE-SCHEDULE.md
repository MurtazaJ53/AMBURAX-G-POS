# Technical Debt Register & Maintenance Schedule

| Document ID | AMB-REL-002 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Engineering Governance Board |

---

## 1. Technical Debt Register

| Debt Item | Description | Severity | Target Milestone | Planned Mitigation |
| :--- | :--- | :--- | :--- | :--- |
| **Large Component Refactor** | `PosTerminal.tsx` has grown large (> 3,000 lines). | Medium | v1.1.0 (Nov 2026) | Extract split payment, shortcuts, and receipts into dedicated modular hooks. |
| **Prisma Query Optimization** | Complex raw SQL joins in `creditSalePosting.ts`. | Low | v1.2.0 (Dec 2026) | Introduce materialized views for fast multi-tenant Khata balance calculations. |
| **Offline IndexedDB Storage** | PWA offline capability currently limited to catalog caching. | Medium | v1.2.0 (Dec 2026) | Implement full offline Dexie.js / IndexedDB sales queue with sync worker. |

---

## 2. Maintenance and Upgrade Schedule

- **Weekly Maintenance Window**: Sunday 02:00 to 03:00 IST (Lowest counter transaction volume).
- **Monthly Patch Cycle**:
  - Node.js dependency vulnerability scans (`npm audit`).
  - PostgreSQL index maintenance (`REINDEX CONCURRENTLY` and `VACUUM ANALYZE`).
- **Quarterly Disaster Recovery Simulation**:
  - Live dry-run restoration of primary PostgreSQL database from S3 cold backup.
