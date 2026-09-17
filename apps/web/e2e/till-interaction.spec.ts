import { test, expect } from "@playwright/test";
import { signIn } from "./auth";
import { db, demoTenant, aSellableVariant } from "./db";
import { ensureTerminal, openShift } from "./terminal";

/**
 * The paths a cashier actually takes, and the ones they end up on when something goes wrong.
 *
 * These could not be written before a terminal existed. What they add over the component suite
 * is that the failures are produced by a real browser against a real server — a stubbed fetch
 * cannot prove that an aborted request reaches the screen as "still checking" rather than as
 * "failed".
 */

test.afterAll(async () => {
  await db.$disconnect();
});

async function readyTill(page: import("@playwright/test").Page) {
  await signIn(page);
  const terminal = await ensureTerminal(page);
  await openShift(page, terminal);
  const { tenant } = await demoTenant();
  const variant = await aSellableVariant(tenant.id);
  return { terminal, tenant, variant };
}

async function scan(page: import("@playwright/test").Page, barcode: string) {
  const field = page.getByLabel(/scan or type a barcode/i);
  await expect(field).toBeEnabled();
  await field.fill(barcode);
  await field.press("Enter");
}

test("F9 completes a sale without touching the mouse", async ({ page }) => {
  test.slow();
  const { tenant, variant } = await readyTill(page);
  await scan(page, variant.barcode!);
  await expect(page.getByText(variant.product.name).first()).toBeVisible();

  const before = await db.sale.count({ where: { tenantId: tenant.id } });
  await page.keyboard.press("F9");
  await expect(page.getByText(/sale complete/i)).toBeVisible({ timeout: 30_000 });
  expect(await db.sale.count({ where: { tenantId: tenant.id } })).toBe(before + 1);

  // The same key starts the next bill, so a queue is one key per customer.
  await page.keyboard.press("F9");
  await expect(page.getByText(/nothing on this bill yet/i)).toBeVisible();
});

test("F2 returns focus to the scan field from anywhere", async ({ page }) => {
  await readyTill(page);
  const customer = page.getByLabel(/search for a customer by name or phone/i);
  await customer.focus();
  await expect(customer).toBeFocused();

  await page.keyboard.press("F2");
  await expect(page.getByLabel(/scan or type a barcode/i)).toBeFocused();
});

test("an unknown barcode is named as such, in the browser", async ({ page }) => {
  await readyTill(page);
  await scan(page, "0000000000000");

  // Scoped to the till: Next.js renders its own route announcer with role="alert", and an
  // unscoped query matches both.
  const alert = page.locator("[data-amburax]").getByRole("alert");
  await expect(alert).toContainText(/barcode not found/i);
  await expect(alert).toContainText(/0000000000000/);
  await expect(page.getByText(/nothing on this bill yet/i)).toBeVisible();
});

test("a double click cannot ring the same basket up twice", async ({ page }) => {
  test.slow();
  const { tenant, variant } = await readyTill(page);
  await scan(page, variant.barcode!);
  await expect(page.getByText(variant.product.name).first()).toBeVisible();

  const before = await db.sale.count({ where: { tenantId: tenant.id } });
  const pay = page.getByRole("button", { name: /^Take / });
  await pay.scrollIntoViewIfNeeded();

  // Two clicks as fast as the browser will deliver them. The second is dropped by the state
  // machine rather than by the button's disabled attribute, which is what also covers a
  // scanner's trailing newline.
  await pay.dblclick();
  await expect(page.getByText(/sale complete/i)).toBeVisible({ timeout: 30_000 });

  expect(await db.sale.count({ where: { tenantId: tenant.id } })).toBe(before + 1);
});

test("an unanswered sale is never reported as a failure", async ({ page }) => {
  test.slow();
  const { tenant, variant } = await readyTill(page);
  await scan(page, variant.barcode!);
  await expect(page.getByText(variant.product.name).first()).toBeVisible();

  // The request never lands, so the outcome is genuinely unknown to the browser — the exact
  // situation in which telling a cashier "failed" makes them charge the customer twice.
  await page.route("**/api/v1/sales", (route) => route.abort("connectionfailed"));

  const before = await db.sale.count({ where: { tenantId: tenant.id } });
  const pay = page.getByRole("button", { name: /^Take / });
  await pay.scrollIntoViewIfNeeded();
  await pay.click();

  // The intermediate wording depends on how the request died and how far the retry has got —
  // "connection lost", "no answer yet", or "checking with the server". Any of the three is the
  // right thing to say; what matters is that all of them describe an unknown outcome rather than
  // a failure, so the assertion accepts whichever arrives.
  await expect(
    page.getByText(/connection lost|no answer yet|checking with the server/i).first(),
  ).toBeVisible({ timeout: 15_000 });

  // And where it settles once the retries are exhausted: still not a failure.
  await expect(page.getByText(/sale not confirmed/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/check today/i).first()).toBeVisible();

  // The screen must never use the word, and nothing may have been charged.
  const body = await page.locator("[data-amburax]").innerText();
  expect(body.toLowerCase()).not.toContain("sale failed");
  expect(await db.sale.count({ where: { tenantId: tenant.id } })).toBe(before);
});

test("a closed shift stops selling", async ({ page }) => {
  test.slow();
  const { terminal } = await readyTill(page);

  await page.getByRole("button", { name: /close shift/i }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: /close shift/i }).click();
  await expect(page.getByText(/this shift is closed/i)).toBeVisible();
  await expect(page.getByLabel(/scan or type a barcode/i)).toBeDisabled();

  // Left open for the next test in the file, and for the next run: the helper resumes rather
  // than reopening, so leaving it closed would change what every other test starts from.
  await openShift(page, terminal);
});
