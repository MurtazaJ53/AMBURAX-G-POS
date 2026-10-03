# F9 Payment / Split Payment Discovery & Design Audit

## 1. Current Backend Payment Capabilities
- **Model Support:** The Prisma schema supports multiple payments via the SalePayment relation (payments: SalePayment[]) on Sale.
- **Payment Method Boundaries:** 
  - SalePaymentInput supports exactly three types: "CASH" | "UPI" | "CARD".
  - There is **no gateway integration**. The comments explicitly state: "Operator-typed UPI/card reference. Never a gateway token — no gateway is integrated." Thus, UPI and CARD mean "externally confirmed" and are recorded manually.
- **Constraints:** Total paid amount must cover the total due for a sale to complete correctly, but the backend uses 	otals.totalMinor strictly as server-computed due.
- **Idempotency & Replay:** Built-in via idempotencyKey per tenant. A duplicate network request returns the already completed original sale instead of ringing it twice.

## 2. Current Frontend Payment Capabilities
- **PosTerminal (/pos):** Offers UI buttons for CASH, UPI, CARD, SPLIT, and MORE.
- **Logic:**
  - CASH: Tracks mountReceived locally, calculates change on-the-fly (mountReceived - totalDue), and rejects if mountReceived < totalDue.
  - CARD/UPI: Collects an optional eference string input.
  - **Fallback/Placeholder:** If SPLIT or MORE is selected, the frontend artificially falls back to sending "CASH" as the method to the backend.

## 3. Existing Payment API/Contracts
- **API (createSale):** The saleService.ts module exports a single backend mutation createSale.
- **Contract Mismatch:** CreateSaleInput accepts only a single payment: SalePaymentInput object per request.
- **Missing API:** The backend API cannot accept a list of split payments (SalePaymentInput[]) inside createSale yet.

## 4. Existing SalePayment Schema
- **Structure:**
  - id (String, cuid)
  - saleId (String, cascade delete)
  - method (enum: CASH, UPI, CARD, etc.)
  - status (enum: PENDING, CONFIRMED)
  - mountMinor (Int)
  - eference (String, nullable)
  - confirmedAt (DateTime)

## 5. Split-Payment Support
- **Backend:** Schema.prisma structurally allows 1-to-many payments on a sale, but saleService.ts currently forces exactly **1** payment upon creation and sets its amount immediately to the computed paidMinor.
- **Frontend:** UI has a stub SPLIT button which currently casts down to a single CASH payment. No split payment interface exists.

## 6. Reference/Design Source Found
- Searched: SCREENS/, Figma documentation (FIGMA-TO-AMBURAX.md), and across the workspace for "Payment", "Split", "Checkout".
- **Result:** No design reference, Figma export, screenshot, or Replit package could be found for the payment modal or split payment states.
- **F9 DESIGN SOURCE = MISSING**

## 7. Exact Screen/Route
- **Route:** /pos
- **Context:** Rendered conditionally/modally inside the Checkout panel upon pressing "Complete Sale", or expanding on the current payment methodology inside the right-hand panel of PosTerminal.tsx.

## 8. UX States (Contract Definition)
1. **Selection:** User selects a payment method (Cash, UPI, Card, Split).
2. **Amount Input:** Amount received field appears. Defaults to total remaining.
3. **Change Calculation:** If Cash and amount > due, compute change.
4. **References:** If Card/UPI, an optional Reference field appears.
5. **Split Management (Missing UI):** Dynamic list of payment chunks. Shows Remaining vs Paid. Prevents completion if Remaining > 0.
6. **Confirmation:** Submits payload. Replaces POS panel with "Payment Successful" upon 200 OK.

## 9. Failure Matrix
- **Amount < Due:** Cannot complete sale. (Frontend blocking).
- **Exact Amount:** Normal success.
- **Overpayment:** Allowed only for CASH. Returns computed change.
- **Zero / Negative Amount:** Rejected by frontend / backend.
- **Split that does not sum to due:** Completion button must remain disabled.
- **Duplicate Submission:** Backend idempotency key returns the original completed sale safely.
- **Network Failure:** Show local toast, do not discard cart. User can retry.
- **Browser Refresh:** Cart clears (currently in-memory state).
- **Sale Already Completed:** Handled via idempotency and/or HTTP 409/403.

## 10. Security/Authorization Findings
- **Tenant & Store Isolation:** Enforced dynamically on the createSale endpoint via server session context and checking current active store.
- **Idempotency:** Replay attacks mitigated securely via a client-generated UUID idempotencyKey sent during createSale.
- **Payment Amounts:** The frontend never dictates 	otalMinor or 	axMinor—these are securely calculated server-side based on ariantId. Only mountReceived (cash) or mountMinor (split part) are accepted as payment directives.

## 11. Responsive Requirements
Must adhere to F8 constraints and flex-scaling logic:
- 1536 × 1024 / 1280 × 1024: Right-hand panel operates at fixed 390px width.
- 900 × 1024 (Tablet): Products pane collapses, Right-hand panel expands to full width, stacks below with shrink-0 bounds.
- 390 × 844 (Mobile): Native flex-column stack. Checkout pane handles vertical scroll. Payment screen/modal must fit within a 390px width constraint without hiding action buttons off-screen.

## 12. Accessibility Requirements
- Payment method selectors must be <button> elements with ria-pressed.
- Focus must trap if Payment is rendered as a modal, or logically follow if it replaces the Cart pane.
- Tab order must flow: Method -> Amount Input -> Reference (if any) -> Complete Button.
- Enter key should submit if mountReceived >= totalDue.

## 13. Missing Backend Contracts
- saleService.ts -> CreateSaleInput must be refactored from payment: SalePaymentInput to payments: SalePaymentInput[] to support Split.
- Server-side validation must ensure sum(payments.map(p => p.amountMinor)) >= sale.totalMinor.

## 14. Missing UI Contracts
- The entire Split Payment interface (adding rows, removing rows, showing remaining balance).
- The authoritative visual design reference for the payment states.

## 15. Implementation Scope
- **Backend:** Update saleService.ts to process CreateSaleInput.payments[].
- **Frontend:** Build payment/split payment interface matching the design.
- **Tests:** Add integration tests for Split Payments equaling exact, and exceeding total (cash).

## 16. Explicit Out-of-Scope Items
- **Actual Gateway Integration:** No Stripe, Razorpay, or PineLabs logic.
- **Backend accounting (ERPNext):** POS does not post directly to ERP.
- **Persistent Cart:** Cart remains in memory.

## 17. Risks
- Launching implementation without a design source leads to throwaway code.
- Refactoring payment to payments breaks the existing simple createSale integration. Both frontend and backend must update atomically.

## FINAL STATUS
**F9 = BLOCKED — DESIGN SOURCE MISSING**
