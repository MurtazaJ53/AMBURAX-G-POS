# UAT Sign-Off & Performance Benchmarks

| Document ID | AMB-QA-003 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Product Acceptance Board |

---

## 1. Performance Benchmarks & Stress Results

Performance tests were conducted using simulated 20-till concurrency against PostgreSQL 16 on standard cloud infrastructure:

| Operation | Metric | Target | Benchmark Achieved | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Exact Barcode Scan** | Response Latency | < 100ms | **34ms** | Passed |
| **Cart Auto-Promotion Evaluation** | Client Computation | < 16ms | **2.8ms** | Passed |
| **Sale Checkout Transaction** | p95 Latency | < 500ms | **218ms** | Passed |
| **Outbox Event Dispatch** | Queue Relay Lag | < 5.0s | **1.2s** | Passed |
| **Ledger Sum Verification** | Query Execution | < 150ms | **42ms** | Passed |

---

## 2. User Acceptance Testing (UAT) Sign-Off

The business stakeholders, store managers, and accounting leads have formally completed end-to-end verification across the following workflows:

- [x] Fast scanner item addition and removal.
- [x] Apparel dual GST slab calculation (5% under ₹1,000; 12% above).
- [x] Split payment settlement (Cash + UPI + Udhar).
- [x] In-modal F6 offer starting, stopping, and clearing.
- [x] Continuous Udhar bills without blocking on past due invoices.
- [x] Shift opening float and blind cash drawer close.

**Final UAT Verdict**: **ACCEPTED FOR PRODUCTION DEPLOYMENT**
