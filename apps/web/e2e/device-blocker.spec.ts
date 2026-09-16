import { test, expect } from "@playwright/test";
import { signIn } from "./auth";
import { db, demoTenant } from "./db";

/**
 * Evidence for a product gap, recorded as a test rather than as a claim in a report.
 *
 * The till needs a terminal id to open a shift. The only place in the product that creates a
 * terminal is the onboarding step, and that step refuses once onboarding is complete — so a
 * business that finishes setup without a till, or later buys a second one, has no supported way
 * to add it. This asserts the refusal really happens, at the real endpoint, as the real owner.
 *
 * It is written to pass while the gap exists. When someone adds a supported path for creating a
 * terminal after onboarding, this test should be deleted along with the gap.
 */

test("a completed business has no supported way to add a POS terminal", async ({ page }) => {
  await signIn(page);

  // Read from the database rather than from an endpoint: the product deliberately never sends
  // a store id to a client, so there is none to ask for.
  const { tenant, store } = await demoTenant();
  expect(tenant.onboardingStep).toBe("COMPLETE");

  const response = await page.request.post("/api/v1/onboarding/pos", {
    data: {
      skip: false,
      storeId: store.id,
      name: "E2E Terminal",
      code: "E2E-01",
      showProductImages: true,
      scanSoundEnabled: true,
      cashDrawerEnabled: false,
    },
  });

  // 409 already_completed: the onboarding step is the gate, and it has closed.
  expect(response.status()).toBe(409);
  expect((await response.json()).error.code).toBe("already_completed");

  // And the consequence, stated plainly: still no terminals, so no shift, so no sale.
  const devices = await page.request.get("/api/v1/pos/devices");
  expect((await devices.json()).devices).toHaveLength(0);
});

test.afterAll(async () => {
  await db.$disconnect();
});
