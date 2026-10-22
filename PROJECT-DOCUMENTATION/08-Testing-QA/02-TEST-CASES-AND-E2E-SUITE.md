# Test Cases & Playwright E2E Test Suite

| Document ID | AMB-QA-002 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Lead Automation Engineer |

---

## 1. Core End-to-End Test Scenarios

### TC-E2E-001: Pure Udhar Checkout with Zero Down Payment
- **Preconditions**: Customer selected with verified phone number and active credit limit.
- **Steps**:
  1. Add 3 items to cart (Subtotal: ₹3,000.00).
  2. Select payment method `UDHAR`.
  3. Leave "Amount Paid Now" as blank or `₹0`.
  4. Press `F8` (Complete Sale).
- **Expected Result**: Sale succeeds; Bill generated (`STR-...`); net due becomes ₹3,000.00; zero "At least one payment is required" errors.

### TC-E2E-002: F6 In-Modal Offer Selection & Clearing
- **Preconditions**: Store has 2 active promotions (e.g. ₹200 OFF and 10% OFF).
- **Steps**:
  1. Add items totaling ₹2,500.00.
  2. Press `F6` to open Offers Modal.
  3. Verify single-best offer is applied by default.
  4. Click "Clear / Remove Offer".
  5. Close modal and verify discount is ₹0.00.
- **Expected Result**: Cashier can remove promotional discount on demand.

---

## 2. Playwright Test Implementation Sample

The automated tests are maintained under `apps/web/e2e/`:
```typescript
test("completes pure udhar checkout with offer toggle", async ({ page }) => {
  await page.goto("http://localhost:3001/pos");
  // 1. Scan item
  await page.keyboard.press("F2");
  await page.keyboard.type("8901234567890");
  await page.keyboard.press("Enter");

  // 2. Open F6 Offer modal and verify controls
  await page.keyboard.press("F6");
  await expect(page.locator("text=Clear / Remove Offer")).toBeVisible();
  await page.keyboard.press("Escape");

  // 3. Complete Udhar sale
  await page.click("button:has-text('Udhar')");
  await page.keyboard.press("F8");
  await expect(page.locator("text=Sale Completed")).toBeVisible();
});
```
