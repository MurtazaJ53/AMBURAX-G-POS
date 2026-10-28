import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Bug 19: after a successful step the sign-up and owner forms hard-reloaded the next page if the
// client navigation took more than 1.2 s. On a slow server that reload landed while the owner was
// already typing on the next page and wiped the form. Navigation is left to the router, with a
// visible link as the fallback, so nothing reloads a page under someone's hands.

const forms = ["src/app/onboarding/business/BusinessRegistrationForm.tsx", "src/app/onboarding/owner/OwnerAccountForm.tsx"];

describe("onboarding forms never hard-reload the next page (bug 19)", () => {
  it.each(forms)("%s has no timed window.location navigation", (file) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    expect(src).not.toMatch(/window\.location\.(href\s*=|assign|replace|reload)/);
  });

  it.each([
    ["src/app/onboarding/business/BusinessRegistrationForm.tsx", "/onboarding/owner"],
    ["src/app/onboarding/owner/OwnerAccountForm.tsx", "/onboarding/store"],
  ])("%s offers a link to the next step instead", (file, next) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    expect(src).toMatch(new RegExp(`<Link[^>]*href="${next}"`));
  });
});
