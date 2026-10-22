# Screen Inventory and User Flows

| Document ID | AMB-DES-002 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Product Design Team |

---

## 1. Master Screen Inventory

| Screen Name | Route / Modal | Target Audience | Primary Function |
| :--- | :--- | :--- | :--- |
| **POS Terminal** | `/pos` | Cashier, Floor Staff | Counter billing, scanning, tender selection |
| **Offer Control Modal** | `F6 Modal` | Cashier, Manager | Toggle offers, select active promo, add new offer |
| **Customer Picker** | `F3 Modal` | Cashier | Search customer, view due, OTP verification |
| **Split Tender Modal** | `F7 Modal` | Cashier | Allocate multiple payment methods |
| **Hold / Recall Modal** | `F4 Modal` | Cashier | Park active sale, resume held bill |
| **Shift Management** | `/shifts` | Cashier, Manager | Open drawer float, shift summary, close drawer |
| **Products & Variants** | `/catalog` | Inventory Mgr | Add product, manage barcodes, pricing, tax rates |
| **Khata Accounts** | `/khata` | Accountant, Owner | Customer credit statements, repayments, adjustments |
| **Purchases & Receiving** | `/purchases` | Inventory Mgr | Purchase orders, GRN receiving, supplier dues |
| **Reports & Analytics** | `/reports` | Store Owner | Sales summary, gross margins, GST return exports |

---

## 2. End-to-End User Flows

### Flow 1: Standard Cash / UPI Checkout

```mermaid
sequenceDiagram
    autonumber
    actor Cashier
    participant Terminal as POS Terminal UI
    participant Scanner as USB Barcode Scanner
    participant Engine as Promotion Engine
    participant Server as /api/v1/sales

    Cashier->>Scanner: Scans Barcode
    Scanner->>Terminal: Injects EAN-13 Barcode + Enter
    Terminal->>Terminal: Add line item to cart
    Terminal->>Engine: Evaluate active promotions
    Engine-->>Terminal: Return promo discount (e.g. ₹200 off)
    Cashier->>Terminal: Presses F8 (Complete Sale)
    Terminal->>Server: POST /api/v1/sales (Method: CASH)
    Server->>Server: Transaction: Sale + Stock Ledger + Outbox
    Server-->>Terminal: 200 OK + Bill Number (e.g. STR-000142)
    Terminal->>Terminal: Render Success Screen & Trigger Thermal Print
```

### Flow 2: Pure Udhar (Credit) Sale with Offers

```mermaid
sequenceDiagram
    autonumber
    actor Cashier
    participant Terminal as POS Terminal UI
    participant Server as Backend API

    Cashier->>Terminal: Scans 5 items (Subtotal ₹4,000)
    Cashier->>Terminal: Presses F6 (Offers Modal)
    Terminal->>Terminal: Displays eligible store promotions
    Cashier->>Terminal: Selects "Diwali Dhamaka ₹300 OFF" or clicks "Clear Offer"
    Cashier->>Terminal: Presses F3 (Select Customer)
    Terminal->>Terminal: Selects "Murtaza (+91 84698 76518)"
    Note over Terminal: Phone verified check: Valid
    Cashier->>Terminal: Selects payment method "UDHAR", Amount Paid: ₹0
    Cashier->>Terminal: Presses F8 (Complete Sale)
    Terminal->>Server: POST /api/v1/sales (onAccountMinor: 370000, payments: [])
    Server->>Server: Bypass overdue block, verify credit ceiling
    Server->>Server: Post DEBIT_CREDIT_SALE to Khata ledger
    Server-->>Terminal: 200 OK (Sale rung successfully on Udhar)
    Terminal->>Terminal: Display Receipt with previous due & new due
```
