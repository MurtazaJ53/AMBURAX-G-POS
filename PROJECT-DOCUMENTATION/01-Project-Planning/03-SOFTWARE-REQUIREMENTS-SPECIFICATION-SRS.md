# Software Requirements Specification (SRS)

| Document ID | AMB-SRS-003 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Production Ready |
| **Date** | 2026-10-19 | Authors | AMBURAX Technical Architecture Team |

---

## 1. Functional Requirements

### 1.1 POS Billing Engine (REQ-POS-01 to REQ-POS-15)
- **REQ-POS-01 (Catalog Search & Barcode Lookup)**: System must resolve exact barcode lookups in `< 80ms`. Non-barcode alphanumeric queries must return fuzzy search hits in `< 150ms`.
- **REQ-POS-02 (Cart Management)**: The cart must support line additions, quantity increments up to 999 units, deletions, line-item discounts, and salesman attribution.
- **REQ-POS-03 (Split Payments)**: The terminal must support combining Cash, Card, UPI, and Udhar tenders. Sum of tenders must exactly equal the total payable amount.
- **REQ-POS-04 (Pure Udhar Settlement)**: When method is `UDHAR` with ₹0 down payment, system must post 100% of the net bill to the customer's Khata account without throwing *"At least one payment is required"*.
- **REQ-POS-05 (Sale Hold & Recall)**: Cashiers must be able to park an active cart (`F4`) to serve another customer and recall it with full state fidelity.

### 1.2 Promotion & Offer Engine (REQ-PROMO-01 to REQ-PROMO-10)
- **REQ-PROMO-01 (Single Offer Default)**: Unless explicitly enabled for stacking by store policy, system must apply the single most beneficial offer for the customer.
- **REQ-PROMO-02 (Counter Offer Controls)**: Inside the POS terminal (`F6`), cashiers and owners must be able to:
  1. Toggle any active offer between **Active** and **Paused**.
  2. Create a new offer directly with type, trigger criteria, and discount amounts.
  3. Select or deselect any applicable offer using radio selection.
  4. Click **Clear / Remove Offer** to ring the sale at standard price (essential for Udhar transactions where discounts are withheld).
- **REQ-PROMO-03 (Server Price Authority)**: All promo discounts must be validated and reconciled server-side against live catalog prices.

### 1.3 Khata & Customer Credit (REQ-KHT-01 to REQ-KHT-12)
- **REQ-KHT-01 (Company Scope)**: Credit accounts must be strictly scoped to the legal Company entity to prevent exposure cross-contamination across independent business units.
- **REQ-KHT-02 (OTP Verification)**: Customer mobile number must be verified via SMS OTP prior to first Udhar issuance.
- **REQ-KHT-03 (Continuous Credit / Multi-Bill Udhar)**: Existing past due or overdue invoices must NOT block the merchant from issuing a subsequent Udhar bill, provided credit limits are respected.
- **REQ-KHT-04 (Immutable Ledger)**: Every credit posting must produce a `DEBIT_CREDIT_SALE` entry in `khata_receivable_entries` with client-provided idempotency keys.

### 1.4 Inventory & Stock Ledger (REQ-INV-01 to REQ-INV-08)
- **REQ-INV-01 (Double-Entry Movements)**: Every sale must generate negative stock movements (`quantityDelta: -N`) associated with the `SaleCompleted` transaction.
- **REQ-INV-02 (Sellable Reservations)**: Real-time stock queries must subtract pending cart reservations from physical on-hand stock (`sellable = on_hand - reserved`).
- **REQ-INV-03 (Cross-Branch Visibility)**: The cashier interface must indicate stock availability in sibling branches when local stock is exhausted.

---

## 2. Non-Functional Requirements

### 2.1 Performance
- **Sub-Second Response**: 95th percentile latency for checkout API requests (`POST /api/v1/sales`) must be `< 350ms`.
- **UI Responsiveness**: POS Terminal state transitions must render within 1 frame (16.6ms) without layout shifting.

### 2.2 Reliability & Availability
- **Transactional Atomicity**: Sale record, line items, tenders, stock decrements, and outbox event emissions must commit in a single PostgreSQL ACID transaction. If any part fails, all changes must roll back completely.
- **Idempotency Guarantee**: Submitting the same `idempotencyKey` multiple times must return the original sale summary without duplicating financial or inventory records.

### 2.3 Security
- **Role-Based Access Control (RBAC)**: Enforce strict separation between Cashier, Floor Staff, Store Manager, and Tenant Owner.
- **Session Protection**: All sessions are cryptographically signed HTTP-only cookies; CSRF tokens guard mutative operations.
- **Audit Trails**: Every discount override, drawer opening, stock adjustment, and price change is recorded with tenant ID, user ID, timestamp, and IP address.
