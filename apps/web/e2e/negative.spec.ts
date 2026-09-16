import { test, expect } from "@playwright/test";
import { signIn } from "./auth";
import { db, demoTenant, aSellableVariant } from "./db";

/**
 * The refusals, against the real server.
 *
 * Every case here is one that cannot succeed by construction — an unknown barcode, a bill with
 * nothing on it, a quantity that is not a quantity. None of them writes, which is what makes it
 * safe to run this file against a database someone else is also using.
 */

test.afterAll(async () => {
  await db.$disconnect();
});

test("an unauthenticated caller is refused by every POS endpoint", async ({ request }) => {
  for (const path of [
    "/api/v1/pos/devices",
    "/api/v1/pos/scan?barcode=8901234500011",
    "/api/v1/capabilities",
    "/api/v1/customers?q=a",
  ]) {
    const response = await request.get(path);
    expect(response.status(), `${path} must refuse an anonymous caller`).toBe(401);
    expect((await response.json()).error.code).toBe("unauthorized");
  }
});

test("a real barcode resolves to a real, sellable item", async ({ page }) => {
  await signIn(page);
  const { tenant } = await demoTenant();
  const variant = await aSellableVariant(tenant.id);

  const response = await page.request.get(
    `/api/v1/pos/scan?barcode=${encodeURIComponent(variant.barcode!)}`,
  );
  expect(response.status()).toBe(200);

  const item = (await response.json()).item;
  // The positive control for the negative cases below: the endpoint really does find things,
  // so a 404 elsewhere means absence and not a broken lookup.
  expect(item.sku).toBe(variant.sku);
  expect(item.isActive).toBe(true);
  expect(item.priceMinor).toBe(variant.priceMinor);
});

test("an unknown barcode is a not-found, not a server error", async ({ page }) => {
  await signIn(page);
  const response = await page.request.get("/api/v1/pos/scan?barcode=0000000000000");
  expect(response.status()).toBe(404);
  expect((await response.json()).error.code).toBe("not_found");
});

test("a blank barcode is rejected as a validation error", async ({ page }) => {
  await signIn(page);
  const response = await page.request.get("/api/v1/pos/scan?barcode=");
  expect(response.status()).toBe(400);
  expect((await response.json()).error.code).toBe("validation_error");
});

test("an empty bill cannot be charged", async ({ page }) => {
  await signIn(page);
  const response = await page.request.post("/api/v1/sales", {
    data: {
      idempotencyKey: `e2e-empty-${Date.now()}`,
      lines: [],
      payment: { method: "CASH" },
    },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error.code).toBe("validation_error");
});

test("a non-integer or non-positive quantity is refused", async ({ page }) => {
  await signIn(page);
  const { tenant } = await demoTenant();
  const variant = await aSellableVariant(tenant.id);

  for (const quantity of [0, -1, 1.5]) {
    const response = await page.request.post("/api/v1/sales", {
      data: {
        idempotencyKey: `e2e-qty-${quantity}-${Date.now()}`,
        lines: [{ variantId: variant.id, quantity }],
        payment: { method: "CASH" },
      },
    });
    expect(response.status(), `quantity ${quantity} must be refused`).toBe(400);
  }
});

test("a sale naming a shift that does not exist is refused", async ({ page }) => {
  await signIn(page);
  const { tenant } = await demoTenant();
  const variant = await aSellableVariant(tenant.id);

  const response = await page.request.post("/api/v1/sales", {
    data: {
      idempotencyKey: `e2e-badsession-${Date.now()}`,
      lines: [{ variantId: variant.id, quantity: 1 }],
      posSessionId: "does-not-exist",
      payment: { method: "CASH" },
    },
  });
  // Naming a shift does not make it yours, open, or this store's — the server checks.
  expect(response.status()).toBe(409);
  expect((await response.json()).error.code).toBe("invalid_session");

  // And nothing was written on the way to refusing.
  const sale = await db.sale.findFirst({ where: { tenantId: tenant.id, idempotencyKey: { startsWith: "e2e-badsession-" } } });
  expect(sale).toBeNull();
});

test("opening a shift on a terminal that does not exist is refused", async ({ page }) => {
  await signIn(page);
  const response = await page.request.post("/api/v1/pos/sessions", {
    data: { posDeviceId: "does-not-exist" },
  });
  expect([404, 409]).toContain(response.status());
});
