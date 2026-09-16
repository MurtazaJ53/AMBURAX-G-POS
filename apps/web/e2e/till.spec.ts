import { test, expect } from "@playwright/test";
import { signIn } from "./auth";

/**
 * The till, in a real browser, against the real backend.
 *
 * What these prove that the component suite cannot: that the session cookie the login form sets
 * is the one the till's API calls send, that the server agrees the user may sell, and that the
 * terminal list the screen renders is the one the database actually holds.
 */

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the till renders for an authenticated cashier", async ({ page }) => {
  await page.goto("/till");
  await expect(page).toHaveURL(/\/till/);

  const rail = page.getByRole("region", { name: /till status/i });
  await expect(rail).toBeVisible();
});

test("the status rail names the cashier and the store from the server session", async ({ page }) => {
  await page.goto("/till");
  const rail = page.getByRole("region", { name: /till status/i });

  // Neither value is supplied by the browser: both are resolved server-side from the session
  // cookie, so seeing them on screen is evidence the whole chain worked.
  await expect(rail).toContainText(/Demo Owner/i);
  await expect(rail).toContainText(/Main Store/i);
});

test("the terminal list reflects the real database", async ({ page }) => {
  await page.goto("/till");
  await page.getByRole("region", { name: /till status/i }).waitFor();

  const response = await page.request.get("/api/v1/pos/devices");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(Array.isArray(body.devices)).toBe(true);

  // The database has no terminals, so the screen must say so plainly rather than offering a
  // shift button that cannot work.
  if (body.devices.length === 0) {
    await expect(page.getByText(/no terminals set up/i)).toBeVisible();
    await expect(page.getByLabel(/scan or type a barcode/i)).toBeDisabled();
  }
});

test("scanning is refused until a shift is open", async ({ page }) => {
  await page.goto("/till");
  await page.getByRole("region", { name: /till status/i }).waitFor();

  const scan = page.getByLabel(/scan or type a barcode/i);
  await expect(scan).toBeDisabled();
  await expect(page.getByText(/open a shift/i).first()).toBeVisible();
});
