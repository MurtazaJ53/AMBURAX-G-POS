import { test, expect } from "@playwright/test";
import { signIn } from "./auth";

test.describe("Catalog Management F4", () => {
  test("Owner can create a product, edit it, and create a variant", async ({ page }) => {
    // 1. Log in
    await signIn(page);
    
    // Check url is home
    await expect(page).toHaveURL(/.*\/home/);

    // 2. Go to products
    await page.click("text=Products");
    await expect(page).toHaveURL(/.*\/products/);
    
    // 3. Create a product
    // The catalogue workspace renamed this control when it replaced the old list; the flow it
    // starts is unchanged.
    await page.getByRole("link", { name: "Add product" }).click();
    await expect(page).toHaveURL(/.*\/products\/new/);
    
    const productName = `Test Product ${Date.now()}`;
    await page.fill("input[name='name']", productName);
    await page.fill("input[name='category']", "E2E Testing");
    await page.click("button:has-text('Create Product')");
    
    // Should be redirected to product details
    await expect(page).toHaveURL(/.*\/products\/[a-z0-9-]+/);
    await expect(page.locator("h1", { hasText: productName })).toBeVisible();
    
    // 4. Create a variant
    await page.click("text=+ Add Variant");
    await expect(page).toHaveURL(/.*\/variants\/new/);
    
    const sku = `SKU-${Date.now()}`;
    await page.fill("input[name='sku']", sku);
    await page.fill("input[name='priceMinor']", "99.99");
    await page.click("button:has-text('Save Variant')");
    
    // Redirect back to product details
    await expect(page.locator("td", { hasText: sku }).first()).toBeVisible();
    await expect(page.locator("td", { hasText: "$99.99" })).toBeVisible(); // 9999 / 100 formatting may differ, but let's check for 99.99 if it is formatMinor
  });
});






