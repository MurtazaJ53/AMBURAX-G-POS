/**
 * Where an owner with unfinished onboarding belongs.
 *
 * Found while building A10: every onboarding page redirects to `/home` when its step
 * doesn't match, and both `/auth/login` and `/auth/verify` land on `/home` too — so an
 * owner who closed the tab at A7 and signed back in was dropped on a placeholder with no
 * route back into setup. No redirect loop, just a dead end, and one that gets worse the
 * further through the sequence they got.
 *
 * Kept as a pure function so the mapping is testable and lives in exactly one place. The
 * caller supplies the step it read from the authoritative Tenant row; nothing here trusts
 * a client.
 *
 * Loop safety — each target accepts the step that routes to it:
 *   OWNER_CREATED  -> /onboarding/store    (A7 requires OWNER_CREATED)
 *   STORE_CREATED  -> /onboarding/team     (A8 requires STORE_CREATED)
 *   TEAM_INVITED   -> /onboarding/pos      (A9 accepts STORE_CREATED | TEAM_INVITED)
 *   POS_CONFIGURED -> /onboarding/complete (A10 renders when canComplete)
 *
 * STORE_CREATED deliberately routes to A8 rather than A9: the merchant hasn't seen the
 * team step yet, and skipping them past it would silently make that choice for them.
 * BUSINESS_CREATED returns null because no User exists at that step, so nobody can be
 * signed in to resume; COMPLETE returns null because there is nothing left to resume.
 */
export function onboardingResumePath(onboardingStep: string): string | null {
  switch (onboardingStep) {
    case "OWNER_CREATED":
      return "/onboarding/store";
    case "STORE_CREATED":
      return "/onboarding/team";
    case "TEAM_INVITED":
      return "/onboarding/pos";
    case "POS_CONFIGURED":
      return "/onboarding/complete";
    default:
      return null;
  }
}
