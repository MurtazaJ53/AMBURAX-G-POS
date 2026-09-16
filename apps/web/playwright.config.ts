import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end tests, against a real AMBURAX server and a real database.
 *
 * Deliberately separate from the three vitest configs. Those prove logic and rendering in
 * isolation; this one proves the thing none of them can — that a person can sign in, reach the
 * till, and have the server agree with what the screen said. Nothing here stubs a request.
 *
 * ## Port
 *
 * 3001, and not by accident: another application owns 3000 on this machine. The base URL is
 * overridable so a developer whose AMBURAX runs elsewhere does not have to edit this file.
 *
 * ## No webServer block
 *
 * Playwright can start the app itself, and deliberately does not here. The dev server is
 * long-running and shared with whoever is working on the machine; a test run that killed and
 * restarted it would be a surprise at best. The suite asserts the server is reachable instead,
 * and fails with a clear message when it is not.
 *
 * ## Serial
 *
 * One worker. These tests transact against a shared development database — they open shifts and
 * ring up sales — and two workers racing for the same till would produce failures that say
 * nothing about the product.
 */

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    // A till is a desktop surface first; the responsive checks set their own sizes.
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
