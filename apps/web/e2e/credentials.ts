/**
 * The development identity these tests sign in as.
 *
 * The account is not invented here. It is the one `npm run db:seed` already creates, whose
 * password is stored through the same `hashPassword` the product uses — so signing in exercises
 * real password verification. No session is forged, no authentication is disabled, and these
 * tests reach no endpoint that a customer could not.
 *
 * The password is required from the environment and has no default, deliberately. A default
 * would put a working credential in the repository, and a credential in a repository is a
 * credential regardless of which database it happens to open today.
 *
 * Run as:
 *   E2E_PASSWORD='<the password printed by npm run db:seed>' npm run test:e2e
 */

export const E2E_EMAIL = process.env.E2E_EMAIL ?? "owner@demo.amburax.test";

const password = process.env.E2E_PASSWORD;
if (!password) {
  throw new Error(
    "E2E_PASSWORD is not set. These tests sign in through the real login form and need the " +
      "development account's password; `npm run db:seed` prints it. Nothing is hardcoded here " +
      "on purpose.",
  );
}
export const E2E_PASSWORD = password;

if (!E2E_EMAIL.endsWith(".test")) {
  // A guard rather than a convenience: `.test` is reserved by RFC 6761 and can never resolve to
  // a real domain, so this makes it impossible to point the suite at a production account.
  throw new Error(
    `E2E_EMAIL must be a development account on a .test domain; refusing to run against ${E2E_EMAIL}`,
  );
}
