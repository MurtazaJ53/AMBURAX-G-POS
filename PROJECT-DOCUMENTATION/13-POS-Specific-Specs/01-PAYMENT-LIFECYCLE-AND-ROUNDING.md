# Payment Lifecycle, Tenders & Rounding Specifications

| Document ID | AMB-POS-001 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | POS Payment Engineering Team |

---

## 1. Supported Tender Methods & Payment States

AMBURAX G-POS supports the following counter tender types:

| Tender Code | Description | Verification / Terminal Mechanics |
| :--- | :--- | :--- |
| `CASH` | Physical currency notes and coins | Handled via drawer opening; change calculated automatically. |
| `UPI` | Real-time Indian Unified Payments Interface | Static or dynamic QR code displayed on POS display. |
| `CARD` | Credit / Debit card swipe or EMV chip | Manual reference number capture from bank EDC terminal. |
| `UDHAR` | Customer credit on company Khata | Posts to `khata_receivable_entries` after credit check. |
| `SPLIT` | Combination of two or more tender methods | Sum of allocated amounts must exactly equal bill net total. |

---

## 2. Rounding Algorithms & Cashier Change Rules

To prevent paisa fractions at physical cash counters:
- **Commercial Half-Up Rounding**:
  All line taxes and discounts are calculated using standard 4/5 commercial rounding to the nearest whole integer paisa:
  $$\text{Amount Minor} = \left\lfloor \frac{\text{Value Minor} \times 100 + 0.5}{100} \right\rfloor$$
- **Cash Rounding (50 Paisa Standard)**:
  For physical cash tenders in India, net payable cash is rounded to the nearest ₹1.00 or ₹0.50 per local banking practices.
- **Tender Integrity Invariant**:
  $$\text{Cash Tendered} + \text{UPI Tendered} + \text{Card Tendered} + \text{On-Account Udhar} = \text{Total Bill Minor}$$
  The server strictly refuses any bill where tenders deviate by even 1 paisa from `totalMinor`.
