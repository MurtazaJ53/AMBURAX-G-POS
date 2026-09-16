import { test, expect } from "@playwright/test";
import { signIn } from "./auth";

/**
 * Which routes actually render for a signed-in user.
 *
 * "It compiles" and "it renders" are different claims, and only the second one is worth
 * anything to a merchant. This records the second, for every route in the application shell,
 * so the inventory in the report is measured rather than asserted.
 */

const ROUTES = [
  "/home",
  "/till",
  "/pos",
  "/sales",
  "/products",
  "/customers",
  "/inventory",
  "/khata",
  "/suppliers",
  "/offers",
  "/reports",
  "/commerce",
  "/b2b",
  "/ai",
  "/settings",
];

test("every shell route renders without a server error", async ({ page }) => {
  await signIn(page);

  const results: string[] = [];
  for (const route of ROUTES) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    const status = response?.status() ?? 0;
    const landed = new URL(page.url()).pathname;
    const heading = (await page.locator("h1, h2").first().textContent().catch(() => null))?.trim();
    results.push(`${route} -> HTTP ${status} at ${landed} :: ${heading ?? "(no heading)"}`);
    expect(status, `${route} must not be a server error`).toBeLessThan(500);
  }
  console.log("ROUTE RENDER RESULTS:\n" + results.join("\n"));
});
