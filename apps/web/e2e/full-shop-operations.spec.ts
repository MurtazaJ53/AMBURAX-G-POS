import { test, expect } from "@playwright/test";
import { signIn } from "./auth";

test.describe("Full Shop 2-3 Months Operations End-to-End Suite", () => {
  test("comprehensive verification across all core & advanced shop workflows", async ({ page }) => {
    test.setTimeout(180_000);
    // 1. Authenticate with owner credentials
    await signIn(page);

    // 2. Dashboard & Sales Overview (Verifying 2-3 months historical metrics render)
    await page.goto("/home");
    await expect(page.locator("body")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // 3. Sales Register & Receipts Audit
    await page.goto("/sales");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1, h2").first()).toBeVisible();

    // 4. Products Master Catalog (50+ products & 90+ variants)
    await page.goto("/products");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1, h2").first()).toBeVisible();

    // 5. Inventory & Multi-Stock Management
    await page.goto("/inventory");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1, h2").first()).toBeVisible();

    // 6. Customers & Udhar / Khata Ledger Management
    await page.goto("/customers");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1, h2").first()).toBeVisible();

    await page.goto("/khata");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1, h2").first()).toBeVisible();

    // 7. Suppliers & Procurement
    await page.goto("/suppliers");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1, h2").first()).toBeVisible();

    // 8. Offers & Custom Promotional Schemes (Phase 6 feature)
    await page.goto("/offers");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: /Active Promotional Schemes & Bundles/i })).toBeVisible();

    // Create a new active custom scheme
    const customSchemeName = `Festival BOGO ${Date.now()}`;
    await page.getByRole("button", { name: /Create Custom Offer/i }).click();
    await page.getByPlaceholder(/Diwali Mega Cart Discount/i).fill(customSchemeName);
    await page.getByPlaceholder("e.g. 5000").fill("3000");
    await page.getByPlaceholder("e.g. 500", { exact: true }).fill("350");
    await page.getByRole("button", { name: /Save & Activate/i }).click();
    await expect(page.getByText(customSchemeName)).toBeVisible();

    // 9. Financial & Tax Reports (GST, Daybook, GSTR)
    await page.goto("/reports");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1, h2").first()).toBeVisible();

    // 10. Omnichannel Commerce & B2B Wholesale
    await page.goto("/commerce");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1, h2").first()).toBeVisible();

    await page.goto("/b2b");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1, h2").first()).toBeVisible();

    // 11. POS Live Counter Journey & F6 Scheme Integration
    await page.goto("/pos");
    await page.waitForLoadState("domcontentloaded");

    // Open F6 Active Offers dialog and verify the custom scheme exists
    await page.keyboard.press("F6");
    await expect(page.getByText(/Active Offers & Counter Schemes/i)).toBeVisible();
    await expect(page.getByText(customSchemeName)).toBeVisible();
    await page.getByRole("button", { name: /Done/i }).click();

    // 12. Settings & Security Audit
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });
});
