import { test, expect } from "@playwright/test";
import { signIn } from "./auth";
import { db, demoTenant, aSellableVariant } from "./db";
import { ensureTerminal, openShift } from "./terminal";

/**
 * A cashier's ordinary mouse click must reach the Payment button.
 *
 * This began as a reproduction and is kept as a regression guard, because the defect it caught
 * was invisible to every other kind of test. The button was rendered, enabled, correctly
 * labelled and announced — a component test asserting all four passed while the button could
 * not be clicked in a real browser.
 *
 * What went wrong was layout, not logic. The panels in the right-hand column are flex items and
 * `Panel` carries `min-h-0`, which removes their automatic minimum size; when the column's
 * content grew taller than the column, the panels collapsed instead of the column scrolling.
 * The payment panel's box shrank to 2px while its content still painted 404px tall, and the
 * shift panel — ordered last, therefore painted last — lay over the top of it and swallowed the
 * click.
 *
 * Two things are asserted here, and the second is the one that would catch a recurrence
 * anywhere in the column: that the click lands, and that no panel is being squeezed below its
 * own content height.
 *
 * No force-click, and deliberately no F9. A keyboard shortcut is a convenience, not a substitute
 * for a button working.
 */

test.afterAll(async () => {
  await db.$disconnect();
});

for (const viewport of [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1366x680 small laptop", width: 1366, height: 680 },
]) {
  test(`the Payment button takes a real mouse click at ${viewport.name}`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    await signIn(page);
    const { tenant } = await demoTenant();
    const variant = await aSellableVariant(tenant.id);

    // One shared terminal, reused across runs — a terminal cannot be deleted, so creating one
    // per test would litter the development database and inflate the picker on screen.
    const terminal = await ensureTerminal(page);
    await openShift(page, terminal);

    const scan = page.getByLabel(/scan or type a barcode/i);
    await expect(scan).toBeEnabled();
    await scan.fill(variant.barcode!);
    await scan.press("Enter");
    await expect(page.getByText(variant.product.name).first()).toBeVisible();

    const payButton = page.getByRole("button", { name: /^Take / });
    await expect(payButton).toBeEnabled();

    // No panel may be squeezed below its own content. This is the structural assertion: a
    // crushed panel is what lets one panel's painted content land on top of another's.
    const crushed = await page.evaluate(() => {
      const out: string[] = [];
      for (const node of document.querySelectorAll("[data-amburax] section")) {
        const el = node as HTMLElement;
        const box = Math.round(el.getBoundingClientRect().height);
        // A 2px tolerance covers the panel's own borders.
        if (box > 0 && el.scrollHeight - box > 2) {
          const title = (el.querySelector("h2")?.textContent ?? "panel").trim();
          out.push(`${title}: box ${box}px, content ${el.scrollHeight}px`);
        }
      }
      return out;
    });
    expect(crushed, "no panel may be collapsed below its content").toEqual([]);

    // Scroll it into view the way any user or pointer would, then confirm the pixel at its
    // centre really belongs to the button rather than to something lying over it.
    await payButton.scrollIntoViewIfNeeded();
    const covering = await payButton.evaluate((button: HTMLElement) => {
      const rect = button.getBoundingClientRect();
      const topmost = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      ) as HTMLElement | null;
      if (!topmost) return "(nothing at that point)";
      if (topmost === button || button.contains(topmost)) return "";
      const cls = typeof topmost.className === "string" ? topmost.className : "";
      return `${topmost.tagName.toLowerCase()}.${cls.split(/\s+/).slice(0, 3).join(".")}`;
    });
    expect(covering, "the Payment button must not be covered").toBe("");

    // And the click itself, unforced, with a short timeout so an interception fails fast.
    await payButton.click({ timeout: 8000 });
    await expect(page.getByText(/sale complete|taking payment|checking with the server/i)).toBeVisible({
      timeout: 30_000,
    });
  });
}
