# Test Strategy & Quality Assurance Matrix

| Document ID | AMB-QA-001 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | QA & Test Engineering Lead |

---

## 1. Testing Pyramid & Quality Gates

AMBURAX G-POS applies an automated test pyramid to guarantee zero counter regressions:

```text
       /\
      /  \     E2E Playwright Suite (Browser Automation)
     /----\    - Complete Checkout Flows, Split Payments, F6 Offers Modal
    /      \   
   /--------\  Integration & Service Tests
  /          \ - saleService.ts, stockLedger.ts, creditSalePosting.ts
 /------------\ Unit Tests
/              \ - promotionEngine.ts, saleTotals.ts, taxSettings.ts
----------------
```

---

## 2. Quality Gate Enforcement

1. **TypeScript Typecheck Gate**: `npx tsc --noEmit` must exit with 0 errors across all workspaces.
2. **ESLint / Biome Linting Gate**: Zero unhandled lint errors or unresolved any types.
3. **Automated E2E Test Suite**: Full Playwright regression suite (`npm run test:e2e`) verifying:
   - Full promotional offer application and toggling.
   - Pure Udhar checkout with ₹0 paid down.
   - Shift opening and cash float reconciliation.
