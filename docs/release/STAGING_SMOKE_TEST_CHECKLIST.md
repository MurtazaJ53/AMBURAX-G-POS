# AMBURAX G-POS — Staging Smoke-Test Checklist

| Metadata | Details |
| :--- | :--- |
| **Document ID** | STG-CHK-001 |
| **System** | AMBURAX G-POS |
| **Environment** | Staging Sandbox |
| **Target Audience** | QA Engineers, Store Managers, SREs |
| **Version** | 1.0.0 (October 19, 2026) |

---

## 1. Authentication, Sessions & RBAC

| # | Test Case | Method | Prerequisites | Expected Outcome | Status |
| :---: | :--- | :---: | :--- | :--- | :---: |
| 1.1 | **Owner / Cashier Login** | Manual | Valid credentials | Authenticates, sets `amburax_session` HttpOnly cookie, redirects to Store Workspace or POS. | [ ] |
| 1.2 | **Invalid Password Lockout** | Manual | Test account | 5 bad password attempts trigger temporary lockout window (`LOGIN_LOCKOUT_MINUTES=15`). | [ ] |
| 1.3 | **Role-Based Routing** | Manual | Cashier vs Owner | Cashier cannot access `/settings/company` or `/settings/security`; redirected with clean error. | [ ] |
| 1.4 | **Logout & Session Invalidation** | Manual | Active session | Destroys server-side session in database and clears client cookie. | [ ] |

---

## 2. Multi-Tenant & Store Isolation

| # | Test Case | Method | Prerequisites | Expected Outcome | Status |
| :---: | :--- | :---: | :--- | :--- | :---: |
| 2.1 | **Cross-Tenant Product Shielding** | Automated / API | 2 distinct tenants | Tenant A's products, variants, and barcodes return 404 / empty when scanned by Tenant B. | [ ] |
| 2.2 | **Store Scope Isolation** | Manual | Multi-store setup | Bills generated under Store 1 carry sequential Bill Numbers distinct and independent from Store 2. | [ ] |
| 2.3 | **Customer Privacy Protection** | Manual | Global search | Customer telephone search never displays credit balances or financial records to unauthorized stores. | [ ] |

---

## 3. POS Terminal & Checkout Flow

| # | Test Case | Method | Prerequisites | Expected Outcome | Status |
| :---: | :--- | :---: | :--- | :--- | :---: |
| 3.1 | **Hardware / USB Barcode Scanning** | Hardware / Keyboard | Barcode Scanner | Scanning barcode inputs into search field and instantly appends matching SKU to cart. | [ ] |
| 3.2 | **Rapid Duplicate Scans** | Manual / Automated | Standard SKU | Re-scanning the same barcode increments quantity on existing line without creating a new row. | [ ] |
| 3.3 | **Apparel GST Slab Calculation** | Automated / Manual | Price <> ₹1,000 | Apparel $\le$ ₹1,000 taxes at 5% GST; apparel $>$ ₹1,000 taxes at 12% GST dynamically. | [ ] |
| 3.4 | **Cash Payment & Change** | Manual | Open shift | Full tender recorded; exact change due displayed on screen and receipt. | [ ] |
| 3.5 | **Split Tender (Cash + UPI)** | Manual | Valid cart | Bill splits across payment methods; sum matches totalMinor; recorded in single transaction. | [ ] |
| 3.6 | **Idempotent Double-Click Guard** | Manual | Slow connection | Double-clicking "Take Payment" submits single transaction; replayed key returns original sale. | [ ] |

---

## 4. Hardware Printing & Thermal Receipts

| # | Test Case | Method | Prerequisites | Expected Outcome | Status |
| :---: | :--- | :---: | :--- | :--- | :---: |
| 4.1 | **Browser Print Dialog** | Manual | System Printer | Clicking "Print Receipt" or pressing F3 opens print dialog with correct 80mm/58mm CSS styling. | [ ] |
| 4.2 | **ESC/POS Network / USB Printer** | Hardware | ESC/POS Printer | Receipt prints store details, GSTIN, invoice number, items, payment mode, and tax breakdown. | [ ] |

---

## 5. Offline Resiliency & Queue Synchronization

| # | Test Case | Method | Prerequisites | Expected Outcome | Status |
| :---: | :--- | :---: | :--- | :--- | :---: |
| 5.1 | **Offline Billing Mode** | Manual | Disconnect network | UI indicates "Offline"; scan resolves against local IndexedDB cache; checkout succeeds with `OFF-...` bill. | [ ] |
| 5.2 | **Automatic Background Queue Replay** | Manual | Reconnect network | Reconnection triggers sync; offline sale replays with original idempotency key; status updates to `SYNCED`. | [ ] |
| 5.3 | **Indeterminate Network Recovery** | Manual | Simulated timeout | Online connection drop triggers polite `"Sale not confirmed"` message directing cashier to review today's sales. | [ ] |

---

## 6. Khata (Customer Udhar) & Returns

| # | Test Case | Method | Prerequisites | Expected Outcome | Status |
| :---: | :--- | :---: | :--- | :--- | :---: |
| 6.1 | **On-Account Sale (Khata)** | Manual | Verified customer | Credit limit enforced; sale posts to `customer_credit_accounts` and writes `DEBIT_CREDIT_SALE`. | [ ] |
| 6.2 | **Khata Repayment Flow** | Manual | Active Khata balance | Repayment collected at counter reduces balance chronologically and updates ledger entry. | [ ] |
| 6.3 | **Item Return & Price Preservation** | Manual | Existing bill | Return processed preserves historical sale price, restocks inventory, and updates accounting outbox. | [ ] |

---

## 7. ERPNext Background Synchronization & Operations

| # | Test Case | Method | Prerequisites | Expected Outcome | Status |
| :---: | :--- | :---: | :--- | :--- | :---: |
| 7.1 | **Outbox Dispatcher Daemon** | SRE / Ops | PM2 running | `amburax-pos-outbox` claims pending `SaleCompleted` events using `FOR UPDATE SKIP LOCKED`. | [ ] |
| 7.2 | **ERPNext Sales Invoice Creation** | SRE / Ops | Sandbox ERP site | Event successfully delivers to ERPNext REST API; ERP invoice number returned and mapped. | [ ] |
| 7.3 | **Error Backoff & Dead-Lettering** | SRE / Ops | ERP downtime | Failed ERP calls apply exponential backoff ($30\text{s} \to 60\text{s} \to \dots \le 1\text{h}$) up to 8 attempts. | [ ] |
| 7.4 | **System Health Endpoint** | Automated | HTTP curl | `GET /api/v1/operations/sync-status` returns pending queue count, failed events, and transport health. | [ ] |
