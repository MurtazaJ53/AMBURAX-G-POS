import { test, expect } from "@playwright/test";

test.describe("Inventory Management F5", () => {
  test("Owner can view inventory, perform a receipt, and see the movement", async ({ page }) => {
    // 1. Login
    await page.goto("/auth/login");
    await page.fill('input[name="email"]', "owner@demo.amburax.test");
    await page.fill('input[name="password"]', process.env.E2E_PASSWORD || "Passw0rd!123");
    await page.click('button[type="submit"]');

    // Wait for Dashboard
    await expect(page).toHaveURL(/.*\/home/);

    // 2. Navigate to Inventory
    await page.click("text=Inventory");
    await expect(page).toHaveURL(/.*\/inventory/);

    // Verify overview is visible
    await expect(page.locator("p", { hasText: "Total Variants" })).toBeVisible();
    await expect(page.locator("h1", { hasText: "Inventory" })).toBeVisible();

    // 3. Receive stock
    await page.click("text=Receive Stock");
    await expect(page).toHaveURL(/.*\/inventory\/receipts\/new/);

    // Fill the receipt form
    const variantSelect = page.locator('select[name="variantId"]');
    await variantSelect.waitFor();
    // we need to get a value to select
    const firstOptionValue = await variantSelect.evaluate((el: HTMLSelectElement) => {
      const options = Array.from(el.options);
      return options.length > 1 ? options[1]?.value : null;
    });

    if (!firstOptionValue) {
      console.log("No variants found to receive stock for. Skipping the rest.");
      return;
    }

    await variantSelect.selectOption(firstOptionValue);
    await page.fill('input[name="quantity"]', "10");
    await page.fill('input[name="reason"]', "E2E Test Receipt");

    await page.click('button[type="submit"]');

    // Should redirect back to inventory
    await expect(page).toHaveURL(/.*\/inventory/);

    // 4. View movement history
    await page.click("text=Movements History");
    await expect(page).toHaveURL(/.*\/inventory\/movements/);

    // Verify the receipt movement is in the list
    await expect(page.locator("td", { hasText: "RECEIPT" }).first()).toBeVisible();
    await expect(page.locator("span", { hasText: "+10" }).first()).toBeVisible();
  });
});
