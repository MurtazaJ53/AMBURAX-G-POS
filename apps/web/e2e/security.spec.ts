import { test, expect } from "@playwright/test";
import { signIn } from "./auth";
import { db, demoTenant } from "./db";

/**
 * What the browser can see, and what it is trusted with.
 *
 * Checked from the outside — network traffic, cookies, page source — because that is the only
 * vantage point an attacker has, and the only one that can prove a claim the source code merely
 * asserts.
 */

test.afterAll(async () => {
  await db.$disconnect();
});

test("the session cookie is not readable from script", async ({ page }) => {
  await signIn(page);
  await page.goto("/till");

  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => /session/i.test(cookie.name));
  expect(session, "a session cookie must exist after signing in").toBeTruthy();
  expect(session!.httpOnly, "the session cookie must be HttpOnly").toBe(true);
  expect(session!.sameSite, "the session cookie must not be sent cross-site").not.toBe("None");

  // The decisive check: script cannot read it, so an XSS cannot exfiltrate it.
  const visible = await page.evaluate(() => document.cookie);
  expect(visible).not.toContain(session!.value);
});

test("the browser never sends a tenant id to the server", async ({ page }) => {
  await signIn(page);

  const offending: string[] = [];
  page.on("request", (request) => {
    if (!request.url().includes("/api/")) return;
    const body = request.postData() ?? "";
    const url = request.url();
    if (/tenantId/i.test(body) || /tenantId/i.test(url)) {
      offending.push(`${request.method()} ${url} ${body}`);
    }
  });

  await page.goto("/till");
  await page.getByRole("region", { name: /till status/i }).waitFor();
  await page.waitForTimeout(1500);

  // Tenant is resolved from the session server-side. A request carrying one would mean the
  // client had been trusted with an authority it must never hold.
  expect(offending).toEqual([]);
});

test("no credential or connection string reaches the page source", async ({ page }) => {
  await signIn(page);
  await page.goto("/till");
  await page.getByRole("region", { name: /till status/i }).waitFor();

  const html = await page.content();
  for (const pattern of [
    /postgres(ql)?:\/\//i,
    /DATABASE_URL/,
    /passwordHash/,
    /deviceSecret/i,
    /pairingCodeHash/i,
    /ERP_[A-Z_]*(KEY|SECRET|PASSWORD|TOKEN)/,
    /SESSION_SECRET/,
  ]) {
    expect(html, `page source must not contain ${pattern}`).not.toMatch(pattern);
  }
});

test("POS reads are scoped to the caller's own tenant and store", async ({ page }) => {
  await signIn(page);
  const { tenant, store } = await demoTenant();

  const response = await page.request.get("/api/v1/pos/devices");
  const devices = (await response.json()).devices as { storeId: string }[];
  for (const device of devices) {
    expect(device.storeId).toBe(store.id);
  }

  // There is no parameter by which another tenant could be named — the endpoint takes none,
  // so a query string cannot widen the scope.
  const attempted = await page.request.get(
    `/api/v1/pos/devices?tenantId=someone-else&storeId=someone-elses-store`,
  );
  expect(attempted.status()).toBe(200);
  const widened = (await attempted.json()).devices as { storeId: string }[];
  expect(widened.length).toBe(devices.length);
  for (const device of widened) {
    expect(device.storeId).toBe(store.id);
  }
  expect(tenant.slug).toBe("demo-retail");
});

test("signing out ends access to the API", async ({ page }) => {
  await signIn(page);
  expect((await page.request.get("/api/v1/pos/devices")).status()).toBe(200);

  await page.request.post("/api/v1/auth/logout");
  const after = await page.request.get("/api/v1/pos/devices");
  expect(after.status()).toBe(401);
});
