import { test, expect } from "@playwright/test";

test.describe("Full Onboarding Journey for Entirely New Shop", () => {
  test("creates a new store, registers owner, sets up shop & verifies all operations", async ({ page }) => {
    test.setTimeout(120_000);

    const timestamp = Date.now().toString().slice(-6);
    const businessName = `Surat Heritage Textiles ${timestamp}`;
    const ownerEmail = `owner_${timestamp}@demo.amburax.test`;
    const ownerPassword = "Passw0rd!123";

    // ── 1. BUSINESS REGISTRATION (/onboarding/business) ───────────────────────────
    await page.goto("/onboarding/business");
    await expect(page.getByRole("heading", { name: /Tell us about your business/i })).toBeVisible({ timeout: 15_000 });

    await page.locator("#businessName").fill(businessName);
    await page.locator("#businessType").selectOption("RETAIL");
    await page.locator("#industry").fill("Apparel & Fashion");
    await page.locator("#country").fill("India");
    await page.locator("#contactEmail").fill(ownerEmail);
    await page.locator("#contactPhone").fill("9876543210");
    await page.locator('input[type="checkbox"]').check();

    await page.getByRole("button", { name: /Continue/i }).click();

    // ── 2. OWNER ACCOUNT CREATION (/onboarding/owner) ─────────────────────────────
    await expect(page).toHaveURL(/\/onboarding\/owner/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /Create your owner account/i })).toBeVisible({ timeout: 15_000 });

    await page.locator("#name").fill("Vikrambhai Patel");
    await page.locator("#email").fill(ownerEmail);
    await page.locator("#password").fill(ownerPassword);
    await page.locator("#confirmPassword").fill(ownerPassword);

    await page.getByRole("button", { name: /Continue/i }).click();

    // ── 3. STORE SETUP (/onboarding/store) ─────────────────────────────────────────
    await expect(page).toHaveURL(/\/onboarding\/store/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /Set up your first store/i })).toBeVisible();

    await page.locator("#name").fill("Main Flagship Store");
    await page.locator("#code").fill("MAIN01");
    await page.locator("#addressLine").fill("Shop 101, Millennium Textile Market");
    await page.locator("#city").fill("Surat");
    await page.locator("#state").fill("Gujarat");
    await page.locator("#postalCode").fill("395002");

    await page.getByRole("button", { name: /Continue/i }).click();

    // ── 4. TEAM INVITATIONS (/onboarding/team) ───────────────────────────────────
    await expect(page).toHaveURL(/\/onboarding\/team/, { timeout: 15_000 });
    await page.getByRole("button", { name: /Skip for now/i }).click();

    // ── 5. POS TERMINAL SETUP (/onboarding/pos) ───────────────────────────────────
    await expect(page).toHaveURL(/\/onboarding\/pos/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /Set up your POS/i })).toBeVisible({ timeout: 15_000 });

    await page.locator("#name").fill("Counter 1 (Main Entrance)");
    await page.getByRole("button", { name: /Create terminal/i }).click();

    // Terminal created -> Pairing screen -> click Continue
    const continueBtn = page.getByRole("button", { name: "Continue" });
    await expect(continueBtn).toBeVisible({ timeout: 10_000 });
    await continueBtn.click();

    // ── 6. ONBOARDING COMPLETE (/onboarding/complete) ─────────────────────────────
    await expect(page).toHaveURL(/\/onboarding\/complete/, { timeout: 20_000 });
    const finishBtn = page.getByRole("button", { name: /Finish setup/i });
    if (await finishBtn.isVisible()) {
      await finishBtn.click();
    }
    await page.waitForURL(/\/dashboard|\/home/, { timeout: 20_000 });
    await page.waitForLoadState("networkidle");

    console.log(`NEW SHOP CREATED SUCCESSFULLY!`);
    console.log(`  Business: ${businessName}`);
    console.log(`  Email:    ${ownerEmail}`);
    console.log(`  Password: ${ownerPassword}`);

    // ── 7. VERIFY NEW SHOP DASHBOARD & CATALOG NAVIGATION ──────────────────────────
    await page.goto("/home");
    await expect(page.locator("h1, h2").first()).toBeVisible();

    // Navigate to Products
    await page.goto("/products");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1, h2").first()).toBeVisible();

    // Navigate to Offers & Create First Custom Offer for the new shop
    await page.goto("/offers");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /Active Promotional Schemes & Bundles/i })).toBeVisible();

    const offerTitle = `Grand Opening 10% Off`;
    await page.getByRole("button", { name: /Create Custom Offer/i }).click();
    await page.getByPlaceholder(/Diwali Mega Cart Discount/i).fill(offerTitle);
    await page.getByPlaceholder("e.g. 5000").fill("2000");
    await page.getByPlaceholder("e.g. 500", { exact: true }).fill("200");
    await page.getByRole("button", { name: /Save & Activate/i }).click();
    await expect(page.getByText(offerTitle)).toBeVisible();

    // Navigate to POS and verify F6 Modal
    await page.goto("/pos");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("F6");
    await expect(page.getByText(/Active Offers & Counter Schemes/i)).toBeVisible();
    await expect(page.getByText(offerTitle)).toBeVisible();
    await page.getByRole("button", { name: /Done/i }).click();

    // Verify Reports, Inventory, and Khata for the new shop
    await page.goto("/inventory");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1, h2").first()).toBeVisible();

    await page.goto("/khata");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1, h2").first()).toBeVisible();

    await page.goto("/reports");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });
});
