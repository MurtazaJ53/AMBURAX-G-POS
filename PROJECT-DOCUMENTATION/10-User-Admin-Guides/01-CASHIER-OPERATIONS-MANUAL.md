# Cashier Operations Manual & Counter SOP

| Document ID | AMB-SOP-001 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Retail Operations & Training Team |

---

## 1. Daily Shift Opening Procedure

1. Power on the counter PC and log into AMBURAX G-POS using your assigned credentials.
2. Navigate to `/shifts` or click **Open Shift** on the top navigation bar.
3. Count the physical cash in the drawer (e.g. ₹2,000 in ₹100, ₹50, ₹10 notes).
4. Enter the counted amount in the **Opening Float** field and click **Confirm Opening**.
5. The cash drawer clicks open to receive the float. Close the drawer; your till is now active for billing.

---

## 2. Fast Billing Step-by-Step

### 2.1 Scanning & Adding Items
- Point the barcode scanner at the product tag. The scanner beeps, and the item immediately appears on the cart table.
- To increase quantity, scan the item again or press `+` on the line.
- For items without barcodes, press `[F1]` to search by item name or category.

### 2.2 Managing Discounts & Promotional Offers
- Press `[F6]` to open the Offers dialog:
  - The system automatically highlights the single best offer for this customer.
  - To pause or start an offer across the store, click the **Toggle** switch.
  - **Important**: If the customer is purchasing on Udhar or paying late, click **Clear / Remove Offer** to bill at regular retail price.
  - Press `[ESC]` to return to the bill.

### 2.3 Selecting Payment & Completing Sale
- **Cash**: Press `[F8]`, enter tender received, press `[Enter]`. The drawer opens, change is displayed, and the receipt prints.
- **UPI**: Show the dynamic QR code on screen; once confirmed, press `[F8]`.
- **Udhar (Credit)**:
  1. Press `[F3]` to select the customer. If phone is unverified, prompt the customer for the 6-digit SMS OTP.
  2. Select payment method `UDHAR`. Enter down payment (or `₹0` if paying nothing now).
  3. Press `[F8]` to complete the bill.

---

## 3. End-of-Day Shift Closing (Z-Report)

1. At the end of your shift, press `[F11]` and select **Close Shift**.
2. Count all cash, checks, and card charge slips currently inside the physical drawer.
3. Enter your count into the blind count form and press **Submit Closure**.
4. The system prints the Z-Report showing gross sales, tender breakdowns, and any variance.
