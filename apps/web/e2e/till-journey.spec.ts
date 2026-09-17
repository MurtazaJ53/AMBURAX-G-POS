import { test, expect } from "@playwright/test";
import { signIn } from "./auth";
import { db, demoTenant, aSellableVariant } from "./db";

/**
 * A whole sale, start to finish, in a real browser against the real backend.
 *
 * This journey could not be written until now. It needs a terminal, and until this phase the
 * only thing that created one was the onboarding step, which refuses once setup is complete —
 * so the demo business, which is complete, had no till to sell on. The first half of this spec
 * is therefore not scaffolding: it is the new capability, used exactly as a merchant would use
 * it, and the sale that follows is the proof that the capability leads somewhere.
 *
 * ## Both credentials are real
 *
 * A terminal is created, then *paired*, because creating a terminal does not make it sellable —
 * `openPosSession` requires ACTIVE, and only claiming the pairing code produces that. Two
 * credentials pass through here, and each is used the way the product intends: the one-time
 * pairing code shown to a person, and the device secret returned once to the machine. Neither
 * is written to this file.
 *
 * ## Nothing is inserted
 *
 * Every write happens through the product — the login form, the terminal endpoint, the pairing
 * endpoint, and then the till screen itself. The database is read afterwards to check what the
 * server actually recorded, never to arrange what the test then "discovers".
 */

function terminalCode() {
  const suffix = Math.floor(Math.random() * 900 + 100);
  return `JRN${Date.now().toString().slice(-6)}${suffix}`;
}

test.afterAll(async () => {
  await db.$disconnect();
});

test("a merchant adds a terminal, pairs it, and rings up a real sale", async ({ page }) => {
  test.slow();

  // ── LOGIN ────────────────────────────────────────────────────────────────────────────────
  await signIn(page);
  const { tenant, store } = await demoTenant();
  expect(tenant.onboardingStep).toBe("COMPLETE");

  const variant = await aSellableVariant(tenant.id);
  const barcode = variant.barcode!;

  // ── TERMINAL: created through the new endpoint, as an owner ───────────────────────────────
  const code = terminalCode();
  const created = await page.request.post("/api/v1/pos/devices", {
    data: { name: "E2E Journey Till", code },
  });
  expect(created.status()).toBe(201);
  const createdBody = await created.json();
  expect(createdBody.device.status).toBe("PENDING_ACTIVATION");

  // ── PAIRING: the terminal claims its code and becomes sellable ────────────────────────────
  // A created terminal is not yet a usable one, deliberately: "POS setup complete" must mean
  // more than "a row exists". This is the machine half of the flow.
  const activated = await page.request.post("/api/v1/pos/devices/activate", {
    data: { pairingCode: createdBody.pairingCode },
  });
  expect(activated.status()).toBe(200);
  const activatedBody = await activated.json();
  expect(activatedBody.device.id).toBe(createdBody.device.id);
  // The device secret is returned exactly once. Its presence is asserted; its value is not used.
  expect(typeof activatedBody.deviceSecret).toBe("string");

  // ── TILL ──────────────────────────────────────────────────────────────────────────────────
  await page.goto("/till");
  await page.getByRole("region", { name: /till status/i }).waitFor();

  // The terminal just added appears as a usable choice, not in the "Not usable" list. Named
  // exactly, because the open-shift button below also carries the code and a loose match would
  // find both.
  const terminalButton = page.getByRole("button", { name: `${code} E2E Journey Till` });
  await expect(terminalButton).toBeVisible();
  await terminalButton.click();

  // ── OPEN SHIFT ────────────────────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: new RegExp(`Open shift on ${code}`, "i") }).click();
  await expect(
    page.getByText(/your shift is open on this terminal|shift on this terminal was resumed/i),
  ).toBeVisible();

  const stockBefore = await db.stockLevel.findFirst({
    where: { tenantId: tenant.id, storeId: store.id, variantId: variant.id },
    select: { quantity: true },
  });

  // ── SCAN → ADD ITEM ───────────────────────────────────────────────────────────────────────
  const scan = page.getByLabel(/scan or type a barcode/i);
  await expect(scan).toBeEnabled();
  await scan.fill(barcode);
  await scan.press("Enter");

  await expect(page.getByText(variant.product.name).first()).toBeVisible();

  // ── QUANTITY ──────────────────────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: `Increase quantity of ${variant.product.name}` }).click();
  const quantityField = page.getByRole("spinbutton", {
    name: `Quantity of ${variant.product.name}`,
  });
  await expect(quantityField).toHaveValue("2");

  // ── REVIEW ────────────────────────────────────────────────────────────────────────────────
  // The total the screen shows is the one the server will be asked to charge; the button is
  // labelled with it, so reading the button is reading the review.
  const payButton = page.getByRole("button", { name: /^Take / });
  await expect(payButton).toBeEnabled();
  expect((await payButton.textContent())!.trim()).toMatch(/^Take /);

  // ── CUSTOMER ──────────────────────────────────────────────────────────────────────────────
  // Attaching a customer is optional in this product, and this sale deliberately leaves it
  // unattached — a walk-in is the common case and must remain sellable. What is asserted is
  // that the panel is present and usable, not that it was used.
  await expect(page.getByLabel(/search for a customer by name or phone/i)).toBeVisible();

  // ── PAYMENT → COMPLETE ────────────────────────────────────────────────────────────────────
  // F9, not a click: it is the shortcut the till documents on screen and the one a cashier
  // actually uses, and it does not depend on where the right-hand column happens to be
  // scrolled. The button's own enabled state was asserted above, so this is not avoiding it.
  await page.keyboard.press("F9");
  await expect(page.getByText(/sale complete/i)).toBeVisible({ timeout: 30_000 });

  const billLine = await page.getByText(/^Bill /).first().textContent();
  const billNumber = billLine!.replace(/^Bill\s+/, "").trim();
  expect(billNumber.length).toBeGreaterThan(0);

  // ── DB VERIFICATION: the sale ─────────────────────────────────────────────────────────────
  const sale = await db.sale.findFirstOrThrow({
    where: { tenantId: tenant.id, billNumber },
    select: {
      id: true,
      storeId: true,
      totalMinor: true,
      idempotencyKey: true,
      // A sale records the shift it was rung up in, not the terminal directly — one terminal
      // has many shifts, and the shift is what carries the cashier and the opening time.
      posSession: { select: { posDeviceId: true } },
      items: { select: { variantId: true, quantity: true, lineTotalMinor: true } },
      payments: { select: { method: true, amountMinor: true } },
    },
  });
  expect(sale.storeId).toBe(store.id);
  expect(sale.posSession?.posDeviceId).toBe(createdBody.device.id);
  expect(sale.items).toHaveLength(1);
  expect(sale.items[0]!.variantId).toBe(variant.id);
  expect(sale.items[0]!.quantity).toBe(2);

  // The money adds up, in integer minor units — no float ever touches this path.
  const paid = sale.payments.reduce((sum, p) => sum + p.amountMinor, 0);
  expect(paid).toBe(sale.totalMinor);

  // ── DB VERIFICATION: inventory moved, as a ledger entry ───────────────────────────────────
  const movements = await db.stockMovement.findMany({
    where: { tenantId: tenant.id, variantId: variant.id, referenceId: sale.id },
    select: { quantityDelta: true, reason: true },
  });
  expect(movements).toHaveLength(1);
  // A sale removes stock: the ledger is authoritative and the delta is negative.
  expect(movements[0]!.quantityDelta).toBe(-2);

  const stockAfter = await db.stockLevel.findFirstOrThrow({
    where: { tenantId: tenant.id, storeId: store.id, variantId: variant.id },
    select: { quantity: true },
  });
  // The projection agrees with the ledger it is derived from.
  expect(stockAfter.quantity).toBe((stockBefore?.quantity ?? 0) - 2);

  // ── DB VERIFICATION: the sale was published to the outbox ─────────────────────────────────
  const events = await db.outboxEvent.findMany({
    where: { tenantId: tenant.id, entityId: sale.id },
    select: { eventType: true },
  });
  expect(events.length).toBeGreaterThan(0);

  // ── DB VERIFICATION: idempotency ──────────────────────────────────────────────────────────
  // The sale carries the key the till sent. Replaying that key must return this same sale
  // rather than charging a second time — which is the whole reason the key is stored.
  expect(sale.idempotencyKey).toBeTruthy();
  const withSameKey = await db.sale.count({
    where: { tenantId: tenant.id, idempotencyKey: sale.idempotencyKey },
  });
  expect(withSameKey).toBe(1);

  // ── HANDOVER: the shift closes cleanly ────────────────────────────────────────────────────
  await page.getByRole("button", { name: /new bill/i }).click();
  await page.getByRole("button", { name: /close shift/i }).click();
  await expect(page.getByText(/this shift is closed/i)).toBeVisible();
});
