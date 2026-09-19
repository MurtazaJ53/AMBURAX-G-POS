import { test, expect } from "@playwright/test";
import { E2E_EMAIL, E2E_PASSWORD } from "./credentials";

test.describe("F6.1 Customer Directory", () => {
  test.beforeEach(async ({ page }) => {
    // Basic login setup for e2e tests
    await page.goto("/auth/login");
    await page.fill('input[name="email"]', E2E_EMAIL);
    await page.fill('input[name="password"]', E2E_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("/home");
  });

  test("loads the customer due & khata page and displays ERP unavailable states", async ({ page }) => {
    await page.goto("/customers");
    await expect(page.locator("text=Customer Due & Khata")).toBeVisible();

    // Check ERP unavailable states (3 on page load + 1 in panel when selected, so 3 here)
    await expect(page.locator("text=ERP receivables data not connected")).toHaveCount(3);
  });

  test("can search customers", async ({ page }) => {
    await page.goto("/customers");
    await page.getByPlaceholder("Search by name, phone or email").fill("UnknownCustomerXYZ");
    await page.getByPlaceholder("Search by name, phone or email").press("Enter");
    await expect(page.getByText("No customers match “UnknownCustomerXYZ”")).toBeVisible();
  });

  test("can open customer detail panel", async ({ page }) => {
    await page.goto("/customers");
    // Wait for the table to load
    await expect(page.locator("table")).toBeVisible();
    
    // Click 'View' on the first customer
    await page.locator("table").getByRole("link", { name: "View" }).first().click();
    
    // Check panel
    await expect(page.getByText("Customer Details")).toBeVisible();
  });
});
