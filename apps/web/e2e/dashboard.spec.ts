import { test, expect } from "@playwright/test";
import { signIn } from "./auth";

test.describe("Dashboard F3.1", () => {
  test("User can log in, view KPIs, and log out", async ({ page }) => {
    // 1. Log in
    await signIn(page);
    
    // Check url is home
    await expect(page).toHaveURL(/.*\/home/);

    // 2. View KPIs
    await expect(page.locator("p", { hasText: "Today's sales" })).toBeVisible();
    await expect(page.locator("h3", { hasText: "Hourly sales" })).toBeVisible();
    await expect(page.locator("h3", { hasText: "Fast moving today" })).toBeVisible();
    await expect(page.locator("h3", { hasText: "Recent sales" })).toBeVisible();
    await expect(page.locator("h3", { hasText: "On shift" })).toBeVisible();

    // 3. Log out via user menu
    const fallbackTrigger = page.locator("header button").last();
    await fallbackTrigger.click();

    const logoutButton = page.locator("div[role='menuitem']", { hasText: "Sign out" });
    await expect(logoutButton).toBeVisible();
    await logoutButton.click();

    // Should be redirected to login
    await expect(page).toHaveURL(/.*\/auth\/login/);
    await expect(page.locator("button", { hasText: "Sign in" })).toBeVisible();
  });
});
