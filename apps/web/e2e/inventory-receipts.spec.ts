import { test, expect } from "@playwright/test";

test.describe("F5.3 New Stock Receipt validations", () => {
  test("Receipt page loads and shows form", async ({ page }) => {
    await page.goto("/auth/login");
    await page.fill('input[name="email"]', "owner@demo.amburax.test");
    await page.fill('input[name="password"]', process.env.E2E_PASSWORD || "Passw0rd!123");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/home/);

    await page.goto("/inventory/receipts/new");
    await expect(page.locator("h3", { hasText: "Receive Stock" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Receive Stock" })).toBeVisible();
  });

  test("Rejects invalid quantity", async ({ page }) => {
    await page.goto("/auth/login");
    await page.fill('input[name="email"]', "owner@demo.amburax.test");
    await page.fill('input[name="password"]', process.env.E2E_PASSWORD || "Passw0rd!123");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/home/);

    await page.goto("/inventory/receipts/new");
    
    // Select first variant
    const variantSelect = page.locator('select[name="variantId"]');
    const firstOptionValue = await variantSelect.evaluate((el: HTMLSelectElement) => {
      const options = Array.from(el.options);
      return options.length > 1 ? options[1]?.value : null;
    });
    
    if (firstOptionValue) {
      await variantSelect.selectOption(firstOptionValue);
    }
    
    // Fill invalid quantity (0)
    const qtyInput = page.locator('input[name="quantity"]');
    await qtyInput.fill("0");
    
    // Submit
    await page.click('button[type="submit"]');
    
    // Should fail HTML5 validation due to min="1"
    const validationMessage = await qtyInput.evaluate((el: HTMLInputElement) => el.validationMessage);
    expect(validationMessage.length).toBeGreaterThan(0);
    
    // Page should not redirect
    await expect(page).toHaveURL(/.*\/inventory\/receipts\/new/);
  });

  test("Unauthorized user cannot access page", async ({ context }) => {
    // Use fresh context for cashier
    const page = await context.newPage();
    
    await page.goto("/auth/login");
    await page.fill('input[name="email"]', "cashier@demo.amburax.test");
    await page.fill('input[name="password"]', process.env.E2E_PASSWORD || "Passw0rd!123");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/home/);
    
    // Try to visit receipts/new
    await page.goto("/inventory/receipts/new");
    
    // Should be redirected to /inventory (or denied)
    await expect(page).not.toHaveURL(/.*\/inventory\/receipts\/new/);
  });
});
