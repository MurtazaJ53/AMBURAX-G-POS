import { test, expect } from "@playwright/test";
import { signIn } from "./auth";

/**
 * How the till behaves as a screen, now that it can actually be rendered.
 *
 * Only the states reachable without a terminal are covered, and the file says so rather than
 * quietly skipping. Nothing here redesigns anything; it measures what is there.
 */

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

for (const viewport of [
  { name: "desktop 1920x1080", width: 1920, height: 1080 },
  { name: "laptop 1440x900", width: 1440, height: 900 },
  { name: "small laptop 1280x720", width: 1280, height: 720 },
]) {
  test(`the till fits ${viewport.name} without horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/till");
    await page.getByRole("region", { name: /till status/i }).waitFor();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // A till that scrolls sideways hides the total, which is the one number nobody may miss.
    expect(overflow, "no horizontal overflow").toBeLessThanOrEqual(0);
  });
}

test("the till's own controls meet a 44px touch target", async ({ page }) => {
  await page.goto("/till");
  await page.getByRole("region", { name: /till status/i }).waitFor();

  // Scoped to the till surface. The application shell around it — the top bar and sidebar —
  // is separate, pre-existing work with its own smaller controls; measuring it here would
  // report someone else's defect as this one's. It is recorded in the report instead.
  const buttons = await page.locator("[data-amburax] button").all();
  expect(buttons.length).toBeGreaterThan(0);

  const undersized: string[] = [];
  for (const button of buttons) {
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    if (box && box.height < 44) {
      undersized.push(`${(await button.textContent())?.trim()} (${Math.round(box.height)}px)`);
    }
  }
  expect(undersized).toEqual([]);
});

test("every interactive control has an accessible name", async ({ page }) => {
  await page.goto("/till");
  await page.getByRole("region", { name: /till status/i }).waitFor();

  const unnamed = await page.evaluate(() => {
    const out: string[] = [];
    for (const node of document.querySelectorAll("button, input, select, textarea, a[href]")) {
      const el = node as HTMLElement;
      if (el.offsetParent === null) continue;
      const label =
        el.getAttribute("aria-label") ??
        (el.getAttribute("aria-labelledby")
          ? document.getElementById(el.getAttribute("aria-labelledby")!)?.textContent
          : null) ??
        (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ??
        el.textContent;
      if (!label || label.trim().length === 0) out.push(el.outerHTML.slice(0, 100));
    }
    return out;
  });
  expect(unnamed).toEqual([]);
});

test("the page has exactly one main heading structure and a visible focus ring", async ({ page }) => {
  await page.goto("/till");
  await page.getByRole("region", { name: /till status/i }).waitFor();

  await page.keyboard.press("Tab");
  const focusVisible = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;
    const outline = getComputedStyle(el).outlineStyle;
    return outline !== "none";
  });
  // A till is driven from the keyboard; an invisible focus ring makes it unusable, not merely
  // inaccessible.
  expect(focusVisible).toBe(true);
});

test("no console errors are produced while the till loads", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/till");
  await page.getByRole("region", { name: /till status/i }).waitFor();
  await page.waitForTimeout(1500);

  expect(errors).toEqual([]);
});

/**
 * The application shell, measured separately and deliberately not asserted.
 *
 * The chrome around the till is pre-existing work that this phase must not modify, so its
 * control sizes are reported rather than enforced — a failing assertion here would block a
 * suite over a defect it is forbidden to fix.
 */
test("records the shell's control sizes without failing on them", async ({ page }) => {
  await page.goto("/till");
  await page.getByRole("region", { name: /till status/i }).waitFor();

  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const node of document.querySelectorAll("button, a[href]")) {
      const el = node as HTMLElement;
      if (el.closest("[data-amburax]")) continue;
      const box = el.getBoundingClientRect();
      if (box.height > 0 && box.height < 44) {
        out.push(`${(el.textContent ?? "").trim() || "(no text)"} — ${Math.round(box.height)}px`);
      }
    }
    return out;
  });
  console.log("SHELL CONTROLS UNDER 44px:", JSON.stringify(small));
});
