import { test, expect } from "@playwright/test";

/**
 * The minimum: is a real AMBURAX server actually there, and does it enforce its own boundary
 * before a single feature test runs?
 *
 * Worth its own file because a failure here means something different from every other failure
 * in the suite — not "the till is broken" but "you are testing nothing".
 */

test("the server under test is AMBURAX and not the application on port 3000", async ({ request }) => {
  const response = await request.get("/api/v1/capabilities");
  expect(response.status()).toBe(401);

  // The envelope is the fingerprint. AMBURAX answers a lowercase `unauthorized` with a
  // correlation id; the other application on this machine answers uppercase and without one.
  const body = await response.json();
  expect(body.error.code).toBe("unauthorized");
  expect(body.correlationId).toBeTruthy();
});

test("an unauthenticated visitor is sent to sign in rather than shown the till", async ({ page }) => {
  await page.goto("/till");
  await expect(page).toHaveURL(/\/auth\/login/);
});

test("the sign-in page renders", async ({ page }) => {
  await page.goto("/auth/login");
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});
