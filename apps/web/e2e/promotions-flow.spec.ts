import { test, expect } from "@playwright/test";
import { signIn } from "./auth";

test.describe("Promotions & Offers End-to-End Workflow", () => {
  test("creates a custom promotion, enables it, and verifies it in POS F6 counter modal", async ({ page }) => {
    // 1. Sign in to G-POS
    await signIn(page);

    // 2. Navigate to /offers
    await page.goto("/offers");
    await expect(page.getByRole("heading", { name: /Active Promotional Schemes & Bundles/i })).toBeVisible({ timeout: 15_000 });

    // 3. Open Create Custom Offer modal
    const createBtn = page.getByRole("button", { name: /Create Custom Offer/i });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // 4. Fill in custom offer form
    const schemeName = `Diwali Mega ${Date.now()}`;
    await page.getByPlaceholder(/Diwali Mega Cart Discount/i).fill(schemeName);
    await page.getByPlaceholder("e.g. 5000").fill("5000");
    await page.getByPlaceholder("e.g. 500", { exact: true }).fill("500");

    // 5. Submit offer
    await page.getByRole("button", { name: /Save & Activate/i }).click();

    // 6. Verify scheme card is created and visible in offers list
    await expect(page.getByText(schemeName)).toBeVisible();

    // 7. Navigate to POS terminal
    await page.goto("/pos");
    await page.waitForLoadState("networkidle");

    // 8. Open F6 Active Offers modal
    await page.keyboard.press("F6");

    // 9. Verify the F6 modal opens and displays the newly created custom scheme
    await expect(page.getByText(/Offers & Counter Schemes/i)).toBeVisible();
    await expect(page.getByText(schemeName)).toBeVisible();

    // 10. Test Stop and Start toggling directly from inside POS F6 modal
    const stopBtn = page.getByRole("button", { name: "Stop" }).first();
    await expect(stopBtn).toBeVisible();
    await stopBtn.click();
    await expect(page.getByRole("button", { name: "Start" }).first()).toBeVisible();

    // Re-start offer
    const startBtn = page.getByRole("button", { name: "Start" }).first();
    await startBtn.click();
    await expect(page.getByRole("button", { name: "Stop" }).first()).toBeVisible();

    // 11. Test Add New Offer directly inside the POS F6 modal without opening offer tab
    await page.getByRole("button", { name: /Add Offer/i }).click();
    const posOfferTitle = `Till Express Flat ₹150 Off ${Date.now().toString().slice(-4)}`;
    await page.getByPlaceholder(/e.g. Festival Flat ₹200 Off/i).fill(posOfferTitle);
    await page.getByPlaceholder("e.g. 2000").fill("1500");
    await page.getByPlaceholder("e.g. 200", { exact: true }).fill("150");
    await page.getByRole("button", { name: /Save & Start Offer/i }).click();

    // 12. Verify the new offer is instantly created, started, and shown right inside POS!
    await expect(page.getByText(posOfferTitle)).toBeVisible();

    // 13. Close F6 modal
    await page.getByRole("button", { name: /Done/i }).click();
    await expect(page.getByText(/Offers & Counter Schemes/i)).not.toBeVisible();
  });
});
