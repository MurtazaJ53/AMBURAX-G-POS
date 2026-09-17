import { expect, type Page } from "@playwright/test";
import { E2E_EMAIL, E2E_PASSWORD } from "./credentials";

/**
 * Sign in the way a cashier does.
 *
 * Through the real form, against real password verification, taking whatever session cookie the
 * server chooses to set. Nothing here writes a session row, mints a token, or knows the cookie's
 * name — if authentication changed tomorrow, this would fail rather than quietly keep passing,
 * which is the only reason a test like this is worth having.
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/auth/login");
  await page.getByLabel(/email/i).fill(E2E_EMAIL);
  // Exact, not /password/i: the reveal toggle beside the field is named "Show password", so a
  // substring match would find two controls and fail on strict mode rather than on the product.
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /sign in|log ?in/i }).click();

  // Landing anywhere inside the application means the server accepted the password and set a
  // session. Asserting on the destination rather than the absence of an error message means a
  // silent failure cannot pass.
  await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 15_000 });
}
