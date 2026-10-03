# F9 Payment / Split Payment Design Spec

## 1. Source/Reference Identification
- **Source Type:** User-uploaded screenshots and phase-2 reference image.
- **Source Location:** .user_uploaded/media_1790157624915.png, .user_uploaded/media_1790158632239.png, and SCREENS/phase-2-screens/pos-checkout.png.
- **Exact Files/Components:** The checkout/payment pane of the POS screen.
- **States Provided:** Only Desktop state is shown. Only the "Cash" payment interaction state is shown. **No visual state for "Split" payment is provided.**

## 2. Exact Screen + Route
- **Screen:** Payment / Split Payment
- **Route:** /pos
- **Design Type:** **In-panel state**. The payment controls appear at the bottom of the right-hand checkout pane, below the cart items and totals. It does NOT use a modal, drawer, or overlay.

## 3. Visual Contract
- **Payment Method Controls:** A horizontal flex/grid row of buttons (Cash, UPI, Card, Split, More).
  - *Active state:* Solid green background, white text, no border.
  - *Inactive state:* White background, light gray border, dark gray text.
- **Amount Fields:** A labeled input field for "Amount Received" with a currency symbol.
- **Quick Amounts:** A row of quick-select buttons below the input (e.g., +1, +10, +100, Exact or nearest rounded currency amounts).
- **Remaining Balance:** Displayed as a text row ("Balance") below the inputs.
- **Confirmation Controls:** A large, full-width "Complete Sale" button with a green background and a box icon.
- **Split Rows:** **NOT SHOWN in source.**
- **Error/Disabled States:** NOT SHOWN in source.

## 4. Interaction Contract
- **Cash:** Selecting Cash shows the "Amount Received" input and quick-amount buttons. 
- **UPI / Card:** Not visually detailed in the source, but inherently require a reference input based on backend constraints.
- **Split:** Button exists, but **NO INTERACTION DESIGN IS SHOWN**. The UI for adding/removing split payments, showing remaining amounts per row, or split validation is missing from the authoritative reference.
- **Cancel/Back:** Not applicable/Not shown (as it's an in-panel state, it is always visible when items are in the cart).
- **Confirmation:** Clicking "Complete Sale" submits the payment payload.
- **Overpayment:** Allowed for cash, yielding a change balance.
- **Exact Payment:** Clicking "Exact" autofills the amount due.

## 5. State Machine
1. Wait for cart to contain items.
2. Default to Cash.
3. User selects method (Cash/UPI/Card/Split).
4. If Split -> **STATE UNKNOWN (Missing Design)**.
5. User enters amount.
6. Validate amount >= total (unless Split).
7. Submit -> Complete sale.

## 6. Backend Contract Changes
- **EXISTING:** SalePayment schema supports 1-to-many payments. Cash, UPI, and Card are supported as manual, non-gateway methods.
- **MISSING / REQUIRES CHANGE:** createSale endpoint currently only accepts a single payment: SalePaymentInput. It must be refactored to accept an array of payments (payments: SalePaymentInput[]).

## 7. Split-Payment Data Model Usage
- The backend SalePayment array will store multiple rows per saleId, each with its own method, mountMinor, and optional eference.
- The total of mountMinor across all payments must be >= sale.totalMinor.

## 8. Validation Rules
- Amounts cannot be negative.
- Sum of payments must cover the exact subtotal + tax - discount (total due).
- Overpayment only permitted on Cash.

## 9. Error States
- Insufficient payment: Disable "Complete Sale" or show validation error.
- Network error: Toast notification.

## 10. Responsive Behavior
- **Desktop (1536, 1280):** In-panel state fixed to the 390px right-hand pane.
- **Tablet (900) / Mobile (390):** The F8 responsive fix dictates this pane becomes full width and stacks below the products. The payment controls will flow naturally in the vertical scroll, preserving the F8 accessibility constraints.

## 11. Accessibility/Keyboard Behavior
- Payment mode buttons must use ria-pressed.
- Inputs require proper <label> association.
- "Complete Sale" must be actionable via keyboard (e.g., F8 shortcut as indicated in the UI).

## 12. Security/Idempotency Requirements
- Payments are never processed via gateway.
- idempotencyKey prevents double-charging on duplicate clicks.
- Amounts are strictly validated server-side.

## 13. Implementation Files Expected to Change
- pps/web/src/server/sales/saleService.ts (API contract)
- pps/web/src/app/(app)/pos/PosTerminal.tsx (State integration)
- pps/web/src/app/(app)/till/_components/PaymentPanel.tsx (UI rewrite)

## 14. Tests Required
- Integration test: Sale with multiple payments (Split).
- UI Test: Amount received calculations.

## 15. Explicit Out-of-Scope Items
- Gateway integrations (Stripe, etc.).
- Backend ERPNext accounting.
- UI Design for Split payments (since it is missing).

## 16. Risks
- **Design Missing:** The actual "Split" interaction is missing from the reference. Implementing it requires inventing UI, which violates the strict rule of following the reference exactly.

# FINAL STATUS
F9 DESIGN AUDIT = COMPLETE
F9 IMPLEMENTATION = NOT STARTED
