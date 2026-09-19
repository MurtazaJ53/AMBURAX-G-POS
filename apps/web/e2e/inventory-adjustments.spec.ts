import { test, expect } from "@playwright/test";

test.describe("F5.4 New Stock Adjustment", () => {
  test("Adjustment page loads and shows form", async ({ page }) => {
    await page.goto("/auth/login");
    await page.fill('input[name="email"]', "owner@demo.amburax.test");
    await page.fill('input[name="password"]', process.env.E2E_PASSWORD || "Passw0rd!123");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/home/);

    await page.goto("/inventory/adjustments/new");
    await expect(page.locator("h3", { hasText: "Adjust Stock" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Adjust Stock" })).toBeVisible();
    await expect(page.locator('select[name="variantId"]')).toBeVisible();
    await expect(page.locator('input[name="quantityDelta"]')).toBeVisible();
    await expect(page.locator('input[name="reason"]')).toBeVisible();
  });

  test("Rejects zero quantity via HTML5 validation", async ({ page }) => {
    await page.goto("/auth/login");
    await page.fill('input[name="email"]', "owner@demo.amburax.test");
    await page.fill('input[name="password"]', process.env.E2E_PASSWORD || "Passw0rd!123");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/home/);

    await page.goto("/inventory/adjustments/new");

    // Select first variant if any
    const variantSelect = page.locator('select[name="variantId"]');
    const firstOptionValue = await variantSelect.evaluate((el: HTMLSelectElement) => {
      const options = Array.from(el.options);
      return options.length > 1 ? options[1]?.value : null;
    });

    if (firstOptionValue) {
      await variantSelect.selectOption(firstOptionValue);
    }

    // Fill zero quantity — backend also rejects it, but HTML5 `required` + custom check applies
    await page.fill('input[name="quantityDelta"]', "0");
    await page.fill('input[name="reason"]', "Test reason");
    await page.click('button[type="submit"]');

    // Should still be on adjustment page (server returns 400)
    await expect(page).toHaveURL(/.*\/inventory\/adjustments\/new/);
  });

  test("Unauthorized user cannot access adjustment page", async ({ context }) => {
    const page = await context.newPage();

    await page.goto("/auth/login");
    await page.fill('input[name="email"]', "cashier@demo.amburax.test");
    await page.fill('input[name="password"]', process.env.E2E_PASSWORD || "Passw0rd!123");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/home/);

    await page.goto("/inventory/adjustments/new");

    // Server redirect should kick the cashier out
    await expect(page).not.toHaveURL(/.*\/inventory\/adjustments\/new/);
  });

  test("Back to Inventory link is present", async ({ page }) => {
    await page.goto("/auth/login");
    await page.fill('input[name="email"]', "owner@demo.amburax.test");
    await page.fill('input[name="password"]', process.env.E2E_PASSWORD || "Passw0rd!123");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/home/);

    await page.goto("/inventory/adjustments/new");
    await expect(page.locator("a", { hasText: "Back to Inventory" })).toBeVisible();
  });
});
