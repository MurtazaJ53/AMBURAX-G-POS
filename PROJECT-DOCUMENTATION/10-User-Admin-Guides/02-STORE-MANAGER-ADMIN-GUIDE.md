# Store Manager & Administrator Guide

| Document ID | AMB-SOP-002 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Store Management & Administration Team |

---

## 1. Managerial Approvals & PIN Configuration

To maintain counter governance while empowering cashiers:

### 1.1 Setting Your Manager Approval PIN
1. Navigate to **Settings** $\rightarrow$ **Store Profile** $\rightarrow$ **Security**.
2. Select your manager account and click **Set Approval PIN**.
3. Enter a secure 4 to 6-digit numeric PIN (e.g. `8492`).
4. Click **Save PIN**. This PIN will be used whenever a cashier applies a discount exceeding 10% of the bill value.

### 1.2 Approving Counter Discounts Over 10%
1. When a cashier types a discount $> 10\%$, the terminal prompts for **Manager Authorization**.
2. The cashier selects your name from the dropdown.
3. Type your 4–6 digit PIN on the till keypad and press **Authorize**.
4. The discount is stamped with your User ID for future audit logs.

---

## 2. Customer Khata Credit Limits & Holds

1. Navigate to the **Khata** menu.
2. Search for the customer by phone number or name.
3. Click **Edit Account**:
   - **Credit Mode**: Select `LIMITED`, `UNLIMITED`, or `BLOCKED`.
   - **Credit Limit (₹)**: Enter the maximum allowable outstanding balance (e.g. `₹50,000`).
   - **Administrative Hold**: Toggle to `ON` if the customer has an active legal dispute or fraudulent check history.
4. Click **Update Credit Account**.

---

## 3. Stock Adjustments & Physical Inventory Audits

1. Navigate to **Inventory** $\rightarrow$ **Adjustments**.
2. Select the Store location and click **New Stock Audit**.
3. Scan items on the sales floor. The system compares physical counts with system on-hand balances.
4. Review variances (surpluses or deficits) and provide a reason code (`DAMAGED`, `EXPIRED`, `SHRINKAGE`, `FOUND`).
5. Click **Post Adjustment**. The system automatically creates `ADJUSTMENT` entries in the stock movement journal.
