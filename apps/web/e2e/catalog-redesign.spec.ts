import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./auth";

/**
 * The catalogue workspace, end to end.
 *
 * Everything here goes through the real application: a real sign-in, real queries, real
 * mutations, a real database. Nothing is stubbed and no session is forged — if authorization
 * or tenancy broke, this fails rather than quietly passing.
 *
 * The journey is deliberately one test rather than several. The product edited in step six has
 * to be the product selected in step four, and splitting that across independent tests would
 * either need shared mutable state or would stop proving that the same row survives the round
 * trip.
 */

/** The catalogue's state lives in the URL, so the URL is what the assertions read. */
function paramsOf(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

function countFrom(text: string | null): number {
  return Number((text ?? "").replace(/[^\d]/g, ""));
}

test.describe("Catalog redesign F4.1", () => {
  test("browse, filter, inspect, edit and extend a product without leaving the workspace", async ({
    page,
  }) => {
    await signIn(page);

    // ── The workspace ────────────────────────────────────────────────────────
    await page.goto("/products");
    await expect(page.getByRole("heading", { name: "Product catalog", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Catalog");

    // The rail's own search proves the filter pane is present. "Filters" alone is ambiguous:
    // the mobile drawer trigger carries the same word.
    await expect(page.getByLabel("Search within results")).toBeVisible();
    const toolbarCount = page.getByText(/^\d[\d,]* products?$/).first();
    await expect(toolbarCount).toBeVisible();

    const total = countFrom(await toolbarCount.textContent());
    expect(total).toBeGreaterThan(0);

    const cards = page.locator('a[href*="sel="]');
    await expect(cards.first()).toBeVisible();
    const firstPageCount = await cards.count();
    expect(firstPageCount).toBeGreaterThan(0);
    // The page size the workspace asks for (now supports larger demo seed up to 24).
    expect(firstPageCount).toBeLessThanOrEqual(24);

    // ── Search within results ────────────────────────────────────────────────
    const searchWithin = page.getByLabel("Search within results");
    await searchWithin.fill("shirt");
    await searchWithin.press("Enter");
    await expect.poll(() => paramsOf(page).get("q")).toBe("shirt");

    const searchedTotal = countFrom(
      await page.getByText(/^\d[\d,]* products?$/).first().textContent(),
    );
    // A search must narrow, never widen.
    expect(searchedTotal).toBeLessThanOrEqual(total);

    await page.goto("/products");

    // ── Filter ───────────────────────────────────────────────────────────────
    // The first category checkbox, whatever this catalogue happens to hold: the test asserts
    // the mechanism, not a category name the seed might rename.
    const firstCategory = page.locator("label").filter({ hasText: /\(\d+\)\s*$/ }).first();
    const categoryLabel = ((await firstCategory.textContent()) ?? "")
      .replace(/\s*\(\d+\)\s*$/, "")
      .trim();
    // `click`, not `check`: ticking a filter navigates, so the input detaches before `check`
    // can read back its own state. The URL is the real assertion anyway.
    await firstCategory.locator('input[type="checkbox"]').click();

    await expect.poll(() => paramsOf(page).get("cat")).toBe(categoryLabel);
    await expect(page.getByRole("button", { name: "Clear all" })).toBeVisible();

    const filteredTotal = countFrom(
      await page.getByText(/^\d[\d,]* products?$/).first().textContent(),
    );
    expect(filteredTotal).toBeGreaterThan(0);
    expect(filteredTotal).toBeLessThanOrEqual(total);

    // ── Select a product ─────────────────────────────────────────────────────
    const firstCard = page.locator('a[href*="sel="]').first();
    await firstCard.click();

    await expect.poll(() => paramsOf(page).get("sel")).not.toBeNull();
    const selectedId = paramsOf(page).get("sel")!;

    const panel = page.getByRole("complementary", { name: /details$/ });
    await expect(panel).toBeVisible();
    // The filter survived the selection — both live in the same URL.
    expect(paramsOf(page).get("cat")).toBe(categoryLabel);

    // ── Detail tabs ──────────────────────────────────────────────────────────
    await expect(panel.getByRole("tab", { name: "Stock" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(panel).toContainText(/Variants \(\d+\)/);

    for (const tab of ["Pricing", "Details", "Images", "Sales"]) {
      await panel.getByRole("tab", { name: tab }).click();
      await expect(panel.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    }

    // ── Grid / list, preserving everything ───────────────────────────────────
    await page.getByRole("link", { name: "List view" }).click();
    await expect.poll(() => paramsOf(page).get("view")).toBe("list");

    expect(paramsOf(page).get("sel")).toBe(selectedId);
    expect(paramsOf(page).get("cat")).toBe(categoryLabel);
    await expect(page.getByRole("complementary", { name: /details$/ })).toBeVisible();

    await page.getByRole("link", { name: "Grid view" }).click();
    // Grid is the default, so it is absent from the URL rather than spelled out.
    await expect.poll(() => paramsOf(page).get("view")).toBeNull();
    expect(paramsOf(page).get("sel")).toBe(selectedId);

    // ── Edit the product, for real ───────────────────────────────────────────
    await page
      .getByRole("complementary", { name: /details$/ })
      .getByRole("link", { name: /Edit/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`/products/${selectedId}/edit`));

    const renamed = `E2E Renamed ${Date.now()}`;
    const nameField = page.locator('input[name="name"]');
    await expect(nameField).toBeVisible();
    await nameField.fill(renamed);
    await page.getByRole("button", { name: "Save Changes" }).click();

    // Persistence is proved by a fresh read, not by the form's own optimism.
    await expect(page).not.toHaveURL(/\/edit$/, { timeout: 15_000 });
    await page.goto(`/products?q=${encodeURIComponent(renamed)}`);
    await expect(page.getByText(renamed).first()).toBeVisible();

    // ── Create a variant, for real ───────────────────────────────────────────
    await page.goto(`/products?sel=${selectedId}`);
    const reopened = page.getByRole("complementary", { name: /details$/ });
    await expect(reopened).toBeVisible();

    const variantCountBefore = Number(
      (((await reopened.textContent()) ?? "").match(/Variants \((\d+)\)/) ?? [])[1] ?? "0",
    );

    await reopened.getByRole("link", { name: /Create variant/ }).click();
    await expect(page).toHaveURL(new RegExp(`/products/${selectedId}/variants/new`));

    const sku = `E2E-${Date.now()}`;
    await page.locator('input[name="sku"]').fill(sku);
    await page.locator('input[name="priceMinor"]').fill("149.50");
    await page.getByRole("button", { name: "Save Variant" }).click();

    await expect(page).not.toHaveURL(/\/variants\/new$/, { timeout: 15_000 });
    await expect(page.getByText(sku).first()).toBeVisible();

    // ── Back to the catalogue, which must show both changes ──────────────────
    await page.goto(`/products?sel=${selectedId}`);
    const afterVariant = page.getByRole("complementary", { name: /details$/ });
    await expect(afterVariant).toContainText(`Variants (${variantCountBefore + 1})`);
    await expect(afterVariant).toContainText(renamed);

    // ── Close the panel ──────────────────────────────────────────────────────
    await afterVariant.getByRole("link", { name: "Close product details" }).click();
    await expect.poll(() => paramsOf(page).get("sel")).toBeNull();
    await expect(page.getByRole("complementary", { name: /details$/ })).toHaveCount(0);

    // ── Sign out ─────────────────────────────────────────────────────────────
    await page.getByRole("button", { name: /Owner|Manager|Cashier|Associate/ }).first().click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 15_000 });
  });

  test("a stale or foreign product id opens no panel", async ({ page }) => {
    await signIn(page);

    // A well-formed id that is not this tenant's resolves to nothing. The catalogue still
    // renders — it simply does not open a panel for a product the caller cannot read.
    await page.goto("/products?sel=p-bbbbbbbbbbbbbbbbbbbbbbbb");

    await expect(page.getByRole("heading", { name: "Product catalog", level: 1 })).toBeVisible();
    await expect(page.getByRole("complementary", { name: /details$/ })).toHaveCount(0);
  });
});
