import { test, expect } from "@playwright/test";
import { signIn } from "./auth";
import { db, demoTenant } from "./db";

/**
 * Adding a POS terminal after onboarding, in a real browser against the real backend.
 *
 * This replaces `device-blocker.spec.ts`, which existed to record a product gap: the till needed
 * a terminal to open a shift, and the only thing that created one was the onboarding step, which
 * refuses once setup is complete. That spec was written to pass while the gap existed and to be
 * deleted with it. This is what stands in its place — the same business, at the same point in its
 * life, now able to add the till it needs.
 *
 * Nothing here inserts a row. The terminal is created through the endpoint a merchant's browser
 * would call, with the session cookie the real login form set, which is the only way this proves
 * anything about the product rather than about Prisma.
 */

/**
 * Unique per call, so repeated runs against a shared development database never collide on a
 * code — and neither do two tests that happen to land in the same millisecond. Twelve characters,
 * inside the sixteen the code format allows.
 */
function terminalCode() {
  const suffix = Math.floor(Math.random() * 900 + 100);
  return `E2E${Date.now().toString().slice(-6)}${suffix}`;
}

test.afterAll(async () => {
  await db.$disconnect();
});

test("a completed business can add a terminal, and the till can then see it", async ({ page }) => {
  await signIn(page);

  const { tenant } = await demoTenant();
  // The precondition that used to be the blocker: onboarding is finished, so the onboarding
  // step would refuse. If this is ever not COMPLETE, the test below proves less than it claims.
  expect(tenant.onboardingStep).toBe("COMPLETE");

  const code = terminalCode();
  const response = await page.request.post("/api/v1/pos/devices", {
    data: { name: "E2E Counter", code },
  });

  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.device.code).toBe(code);
  expect(body.device.status).toBe("PENDING_ACTIVATION");

  // The pairing code is shown once, to the person standing at the terminal.
  expect(typeof body.pairingCode).toBe("string");
  expect(body.pairingCode.length).toBeGreaterThan(0);

  // What the server actually recorded, read straight from the database rather than believed
  // from the response that reported it.
  const row = await db.posDevice.findFirstOrThrow({
    where: { tenantId: tenant.id, code },
    select: { id: true, storeId: true, pairingCodeHash: true, activatedAt: true },
  });
  expect(row.id).toBe(body.device.id);
  expect(row.storeId).toBe(body.device.storeId);
  expect(row.activatedAt).toBeNull();
  expect(row.pairingCodeHash).not.toBeNull();

  // And the point of the whole exercise: the till lists the terminal a merchant just added.
  const listed = await page.request.get("/api/v1/pos/devices");
  expect(listed.status()).toBe(200);
  const codes = (await listed.json()).devices.map((d: { code: string }) => d.code);
  expect(codes).toContain(code);

  await page.goto("/till");
  await page.getByRole("region", { name: /till status/i }).waitFor();
  // The screen no longer tells a merchant they have no terminals, because now they have one.
  await expect(page.getByText(/no terminals set up/i)).toHaveCount(0);
});

test("the creation response carries no credential material beyond the pairing code", async ({
  page,
}) => {
  await signIn(page);

  const response = await page.request.post("/api/v1/pos/devices", {
    data: { name: "E2E Secrets", code: terminalCode() },
  });
  expect(response.status()).toBe(201);

  // A hash is not safe merely because it is hashed: it is the material a device authenticates
  // with. None of it belongs in a response body.
  const raw = await response.text();
  expect(raw).not.toContain("pairingCodeHash");
  expect(raw).not.toContain("deviceSecretHash");
  expect(raw).not.toContain("passwordHash");
  expect(await response.json()).toHaveProperty("device.id");
});

test("a tenant id in the body buys a caller nothing", async ({ page }) => {
  await signIn(page);

  const { tenant, store } = await demoTenant();
  const code = terminalCode();

  const response = await page.request.post("/api/v1/pos/devices", {
    data: { name: "E2E Injection", code, tenantId: "t-not-mine", storeId: "s-not-mine" },
  });
  expect(response.status()).toBe(201);

  // The identifiers in the body were not rejected so much as unreachable: the endpoint reads
  // both from the session, so the terminal lands in the caller's own store regardless.
  const body = await response.json();
  expect(body.device.storeId).toBe(store.id);

  const row = await db.posDevice.findFirstOrThrow({
    where: { code },
    select: { tenantId: true, storeId: true },
  });
  expect(row.tenantId).toBe(tenant.id);
  expect(row.storeId).toBe(store.id);
});

test("an anonymous caller cannot create a terminal", async ({ request }) => {
  // A bare request context, carrying no session cookie — the browser fixture is deliberately
  // not used here, because its context would be signed in.
  const response = await request.post("/api/v1/pos/devices", {
    data: { name: "E2E Anonymous", code: terminalCode() },
  });

  expect(response.status()).toBe(401);
  expect((await response.json()).error.code).toBe("unauthorized");
});

test("a code already in use is refused as a conflict", async ({ page }) => {
  await signIn(page);

  const code = terminalCode();
  const first = await page.request.post("/api/v1/pos/devices", {
    data: { name: "E2E First", code },
  });
  expect(first.status()).toBe(201);

  const second = await page.request.post("/api/v1/pos/devices", {
    data: { name: "E2E Second", code },
  });
  expect(second.status()).toBe(409);
  expect((await second.json()).error.code).toBe("conflict");

  // The refusal left one terminal, not two — the point of a conflict rather than a retry.
  expect(await db.posDevice.count({ where: { code } })).toBe(1);
});
