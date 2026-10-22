# External Integrations Guide: ERP, SMS & Payments

| Document ID | AMB-API-003 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Integrations Architecture Team |

---

## 1. ERPNext Enterprise Adapter

AMBURAX G-POS integrates asynchronously with ERPNext for enterprise accounting and statutory filings:

1. **Mapping Models**:
   - G-POS `Sale` $\rightarrow$ ERPNext `Sales Invoice`
   - G-POS `Payment` $\rightarrow$ ERPNext `Payment Entry`
   - G-POS `StockMovement` $\rightarrow$ ERPNext `Stock Entry` (Purpose: Delivery)
   - G-POS `Customer` $\rightarrow$ ERPNext `Customer`
2. **Sync Mechanism**:
   - Background worker processes outbox events and pushes to ERPNext REST API (`/api/resource/Sales Invoice`).
   - Responses are recorded in G-POS as `erpSyncStatus = 'SYNCED'` with remote ERP invoice number.

---

## 2. SMS Gateway Integration (Twilio / Fast2SMS)

Used for customer authentication and instant transaction receipts:
- **Phone Verification OTP**:
  - 6-digit cryptographic OTP generated via Node.js `crypto.randomInt`.
  - Sent via templated SMS:
    `"Your G-POS verification code is 218590. Valid for 10 minutes. Do not share with anyone."`
  - In development environments, OTP is logged to server stdout for testing convenience.
- **Udhar Debit Alert**:
  - Sent whenever a sale is rung on Udhar:
    `"Dear Customer, Rs 3,700.00 added to your Khata for Bill #STR-000142. Total outstanding: Rs 8,500.00. Thank you for shopping with us!"`

---

## 3. Payment Gateway Integrations (UPI, Cards & Dynamic QR)

- **Dynamic UPI QR Code**:
  - The POS terminal renders dynamic UPI payment intent strings:
    `upi://pay?pa=merchant@upi&pn=AMBURAX+STORE&am=4982.00&cu=INR&tn=Bill-STR-000142`
  - Displays on customer-facing screens or thermal receipt previews.
- **Card Swipe Terminals (POS EDC)**:
  - Supports manual reference capture (`reference: "TXN9812739"`) for external EDC machines, with direct USB/IP protocol hooks for automated terminal settlement.
