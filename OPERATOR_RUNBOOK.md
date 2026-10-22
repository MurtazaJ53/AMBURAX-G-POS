# G-POS Store Operator Runbook & Quick Reference Guide

Welcome to **G-POS (Amburax Retail Suite)**. This guide outlines the essential counter workflows, keyboard shortcuts, cash drawer balancing routines, and ERPNext synchronization procedures for store cashiers and managers.

---

## 1. POS Terminal & Daily Billing (`/pos`)

### Essential Keyboard Shortcuts
| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **F2** | **Scan / Search Item** | Focus the SKU, item name, or barcode search input |
| **F3** | **Print Receipt** | Print the standard 80mm / 58mm thermal receipt |
| **F4** | **Customer Picker** | Link an existing customer or register a new customer |
| **F7** | **Hold Bill** | Park the current cart temporarily to serve the next customer |
| **F8** | **Retrieve Held Bill** | Resume a previously held bill |
| **F9** | **Tender / Checkout** | Open the tender popup (Cash / UPI / Card / Khata) |
| **Esc** | **Dismiss / Close** | Close modals, drawers, or exit inputs |

### Applying Discounts
- **Automatic Promotions**: By default, no unexpected discount is applied (**₹0.00**).
- **Manual Discretionary Discount**: Click the **`+ Add`** button beside the Discount row in the order summary to add a flat ₹ or % discount with a reason.

### Digital e-Bills
- After finalizing any bill, an instant **Digital e-Bill QR Code** is displayed on the screen.
- Customers can scan this QR code directly using their smartphone camera to open and save their GST e-bill at `/sales/[id]`.

---

## 2. Cash Drawer Balancing & Shift Close (`/cash`)

### Shift Close Routine
1. Navigate to **Cash Register** (`/cash/[sessionId]`).
2. Count the physical cash in your drawer at shift end.
3. If the physical drawer cash equals the system **Expected Cash** (Float + Cash Sales + Pay-ins − Pay-outs), click **`I counted it: cash matches`**.
4. If there is a difference (cash short or over):
   - Enter the exact counted figure.
   - Enter an explanatory **Note** (mandatory for variances).
   - Click **`Close shift with this count`**.
5. The session moves to `PENDING_APPROVAL`. A Store Manager or Owner reviews and signs off on the variance before it posts to ERPNext.

---

## 3. Customer Khata (Store Credit) & Collections (`/khata`)

### Selling on Credit (Udhar)
1. Add items to the cart in `/pos`.
2. Link the customer using **F4** (must be a registered customer with credit allowance).
3. At checkout (**F9**), select tender **On Khata (Udhar)**.

### Recording Debt Repayments
1. Go to **Customer Khata** (`/khata/collect`).
2. Search for the customer.
3. Enter the repayment amount and select payment method (**Cash** or **UPI**).
4. The system automatically allocates the payment against the customer's oldest outstanding bills.

---

## 4. Multi-Store Inventory Transfers (`/inventory/transfers`)

### Dispatching Stock to Another Store Branch
1. Navigate to **Inventory &rarr; Transfers &rarr; New** (`/inventory/transfers/new`).
2. Select the **Source Store** (e.g. *TN - MAIN*) and **Destination Store** (e.g. *Surat Ring Road - SURAT2*).
3. Scan or select the variants and quantities to send.
4. Click **`Dispatch Transfer`**. Stock is deducted from the source store and marked as **In Transit**.

### Receiving Stock at Destination
1. Open the transfer record in the receiving store.
2. Verify the physical quantities received against the dispatch manifest.
3. Click **`Accept & Receive`**. Stock is added to destination inventory and an ERPNext **Stock Entry (Material Transfer)** is generated.

---

## 5. Offline Resilience & ERPNext Synchronization

### Operating When Internet / ERP is Down
- The POS terminal operates uninterrupted even if internet connectivity drops.
- Sales, customer records, and inventory movements persist locally in the database.
- As soon as the network connection is restored, the **Outbox Event Publisher** will automatically sync pending transactions to ERPNext in sequential batches.

### Checking Sync Health
- Go to **Settings &rarr; System Health** (`/settings/system-health`).
- Verify that **Failed** count is `0`.
- Click **`Sync now`** if you wish to manually accelerate queue processing.
