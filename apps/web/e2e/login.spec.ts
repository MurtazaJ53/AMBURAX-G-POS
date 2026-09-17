import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { E2E_EMAIL, E2E_PASSWORD } from "./credentials";

/**
 * The sign-in screen, in a real browser, against the real server.
 *
 * The screen was rebuilt to a supplied design and the authentication behind it was deliberately
 * not touched. That is the pair of claims these tests exist to keep honest: the first half checks
 * that the design is actually on the page and usable at the sizes a person will open it at, and
 * the second half checks that the rebuilt form still reaches the same endpoint, still shows the
 * server's own refusal when the password is wrong, and still ends up signed in when it is right.
 *
 * Nothing here stubs a request, forges a cookie or reads the database. A test that mocked the
 * login endpoint would pass just as happily against a login form wired to nothing.
 */

/** Errors the page reported to its own console, which a rebuilt screen is the likeliest to add. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test.describe("sign-in screen", () => {
  test("renders the supplied design without console errors", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/auth/login");

    // Header
    await expect(page.getByText("AMBURAX", { exact: true })).toBeVisible();
    await expect(page.getByText("Retail | Commerce | B2B | Powered by AI")).toBeVisible();

    // Left marketing panel — visible at the configured 1440x900 desktop viewport.
    await expect(page.getByText("All Businesses. One Platform.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Run Your Business");
    await expect(page.getByText("Point of Sale")).toBeVisible();
    await expect(page.getByText("Scalable Platform")).toBeVisible();
    await expect(page.getByText("10K+")).toBeVisible();
    await expect(page.getByText("More Sales. Happier Customers.")).toBeVisible();
    await expect(page.getByText("Multi-Channel")).toBeVisible();
    await expect(page.getByText("Happy Customers")).toBeVisible();

    // Right sign-in panel
    await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /remember me/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /forgot password/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeEnabled();
    await expect(page.getByRole("link", { name: /create account/i })).toBeVisible();
    await expect(page.getByText("Secure & Reliable")).toBeVisible();

    expect(errors, `console errors on /auth/login:\n${errors.join("\n")}`).toEqual([]);
  });

  test("advertises nothing it cannot do", async ({ page }) => {
    await page.goto("/auth/login");

    // AMBURAX has no OAuth and no second language. The design's controls for both are kept
    // visible, and both must be disabled — a control that looks live and does nothing is the
    // failure this asserts against.
    for (const name of [
      /continue with google/i,
      /continue with apple/i,
      /continue with microsoft/i,
    ]) {
      await expect(page.getByRole("button", { name })).toBeDisabled();
    }
    await expect(page.getByText(/social sign-in isn.t available yet/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^language: english/i })).toBeDisabled();
  });

  test("the password reveal toggles the field and nothing else", async ({ page }) => {
    await page.goto("/auth/login");
    const field = page.getByLabel("Password", { exact: true });
    await field.fill("not-a-real-password");

    await expect(field).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(field).toHaveAttribute("type", "text");
    // The value survives the switch; a reimplemented field would lose it.
    await expect(field).toHaveValue("not-a-real-password");

    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(field).toHaveAttribute("type", "password");
  });

  test("the whole form is reachable from the keyboard alone", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByLabel(/email/i).focus();

    const reached: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      reached.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return "none";
          return (
            el.getAttribute("aria-label") ??
            el.getAttribute("id") ??
            el.textContent?.trim().slice(0, 24) ??
            el.tagName
          );
        }),
      );
      await page.keyboard.press("Tab");
    }

    expect(reached.join(" > ")).toMatch(/email/i);
    expect(reached.join(" > ")).toMatch(/password/i);
    expect(reached.some((r) => /show password/i.test(r))).toBe(true);

    // The custom-looking checkbox is a real input behind a painted box; if it had been rebuilt
    // as a div with an onClick it would not be focusable and Space would do nothing.
    const checkbox = page.getByRole("checkbox", { name: /remember me/i });
    await checkbox.focus();
    await expect(checkbox).toBeChecked(); // AMBURAX's pre-existing default, not the design's
    await page.keyboard.press("Space");
    await expect(checkbox).not.toBeChecked();
  });

  test("a wrong password gets the server's refusal, not a client-side guess", async ({ page }) => {
    await page.goto("/auth/login");

    const response = page.waitForResponse(
      (r) => r.url().includes("/api/v1/auth/login") && r.request().method() === "POST",
    );

    await page.getByLabel(/email/i).fill(E2E_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign In" }).click();

    // The request really was made, and the server really refused it. Asserting on the network
    // rather than only on the message is what separates real authentication from a form that
    // prints an error without asking anybody.
    const res = await response;
    expect(res.ok()).toBe(false);

    // Scoped to the form: Next.js gives its route announcer `role="alert"` too, and an
    // unscoped query would match both and fail on strict mode rather than on the product.
    const alert = page.locator("form").getByRole("alert");
    await expect(alert).toBeVisible();
    // The words come from the server, not from this component - the client only maps `code`.
    await expect(alert).toHaveText(/incorrect|invalid/i);
    await expect(page).toHaveURL(/\/auth\/login/);

    // Still on the login screen and still usable — the button came back out of its loading state.
    await expect(page.getByRole("button", { name: "Sign In" })).toBeEnabled();
  });

  test("valid credentials sign in, and signing out returns to this screen", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/auth/login");
    await page.getByLabel(/email/i).fill(E2E_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign In" }).click();

    // Leaving /auth/login at all means the server accepted the password and set a session; the
    // destination is whatever the product decides, which is not this test's business to pin.
    await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 15_000 });

    // And the session is genuinely usable, not merely a redirect that happened.
    await page.goto("/till");
    await expect(page).not.toHaveURL(/\/auth\/login/);

    // Everything up to here is what this screen is answerable for, and it must be silent.
    expect(errors, `console errors during sign-in:\n${errors.join("\n")}`).toEqual([]);

    // Sign out through the product's own endpoint, sharing this browser's cookie jar. The route
    // revokes the session row; it is not a client-side cookie wipe.
    const logout = await page.request.post("/api/v1/auth/logout");
    expect(logout.ok()).toBe(true);

    // A protected route now sends us back, and the sign-in screen is reachable and rendered.
    await page.goto("/till");
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();

    // The till page that was still mounted when the session was revoked re-asks for its terminal
    // list and is refused. Chromium reports every failed fetch as a console error, so that 401
    // surfaces here — and a 401 is the correct answer to an unauthenticated request, which is the
    // entire point of signing out. Anything appearing afterwards that is *not* that is a defect.
    const unexpected = errors.filter((e) => !/401|unauthorized/i.test(e));
    expect(unexpected, `unexpected console errors after logout:\n${unexpected.join("\n")}`).toEqual(
      [],
    );
  });
});

/**
 * The sizes the design is expected to survive, and what "survive" means at each.
 *
 * `lg` is 1024px in this project's Tailwind, which is the breakpoint at which the marketing panel
 * appears. The two phone sizes are below it deliberately: the design's mobile adaptation is to
 * drop the panel entirely rather than stack it, and a test that let the panel reappear on a phone
 * would be letting a 520px column and a feature grid share a 375px screen.
 */
const VIEWPORTS = [
  { name: "desktop 1920x1080", width: 1920, height: 1080, marketing: true },
  { name: "desktop 1440x900", width: 1440, height: 900, marketing: true },
  { name: "desktop 1280x720", width: 1280, height: 720, marketing: true },
  { name: "laptop 1366x680", width: 1366, height: 680, marketing: true },
  { name: "mobile 390x844", width: 390, height: 844, marketing: false },
  { name: "mobile 375x812", width: 375, height: 812, marketing: false },
] as const;

for (const vp of VIEWPORTS) {
  test(`is usable at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/auth/login");

    // No horizontal overflow. Measured against the document rather than eyeballed: a single
    // element a few pixels too wide produces a scrollbar across the whole page.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `horizontal overflow: content ${overflow.scrollWidth}px in ${overflow.clientWidth}px`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // The marketing panel is present or absent by design, not by accident.
    const badge = page.getByText("All Businesses. One Platform.");
    if (vp.marketing) {
      await expect(badge).toBeVisible();
    } else {
      await expect(badge).toBeHidden();
    }

    const email = page.getByLabel(/email/i);
    const password = page.getByLabel("Password", { exact: true });
    const reveal = page.getByRole("button", { name: "Show password" });
    const submit = page.getByRole("button", { name: "Sign In" });

    for (const control of [email, password, reveal, submit]) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box, "control has no layout box").not.toBeNull();
      // Inside the viewport horizontally — a control pushed off-screen is visible to Playwright
      // and useless to a person.
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
    }

    // Actually operable, and by an unforced click: if anything were painted over these, this is
    // where it would show up.
    await email.click();
    await email.fill("someone@example.test");
    await password.fill("typed");
    await reveal.click();
    await expect(password).toHaveAttribute("type", "text");

    // The submit button is a touch target, not a sliver.
    const submitBox = (await submit.boundingBox())!;
    expect(submitBox.height).toBeGreaterThanOrEqual(44);
  });
}
