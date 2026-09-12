import { db } from "@/server/db";

/**
 * Where an owner with unfinished onboarding belongs. Closes audit finding P1-5.
 *
 * The defect this fixes: every onboarding page redirects to `/home` when its step doesn't
 * match, and `/auth/login`, `/auth/verify` and `/` all land on `/home` too — so an owner
 * who closed the tab at A7 and signed back in was dropped on a placeholder with no route
 * back into setup. The mapping below already existed but nothing imported it, so the dead
 * end was still live.
 *
 * `/home` is the single wiring point on purpose. Every authenticated entry path funnels
 * through it, so one server-side guard there covers sign-in, MFA completion, the root
 * redirect, a bookmark and a refresh — without a client ever deciding where onboarding
 * stands.
 *
 * Loop safety, verified against each target's own guard:
 *   OWNER_CREATED  -> /onboarding/store    (A7 requires OWNER + step OWNER_CREATED)
 *   STORE_CREATED  -> /onboarding/team     (A8 requires OWNER + step STORE_CREATED)
 *   TEAM_INVITED   -> /onboarding/pos      (A9 accepts STORE_CREATED | TEAM_INVITED)
 *   POS_CONFIGURED -> /onboarding/complete (A10 renders when canComplete)
 *
 * STORE_CREATED deliberately routes to A8 rather than A9: the merchant hasn't seen the
 * team step yet, and skipping them past it would silently make that choice for them. A9
 * accepts STORE_CREATED as well, so a user who navigates there directly is not bounced.
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
      // BUSINESS_CREATED: no User exists at that step, so nobody can be signed in to
      // resume — the A5 -> A6 handoff carries an OnboardingSession token in sessionStorage
      // instead, and a lost token is a genuinely stranded tenant (recorded as a known
      // limitation, not silently papered over).
      // COMPLETE: there is nothing left to resume, and completion must stay final.
      return null;
  }
}

export interface OnboardingResumeDecision {
  /** Where to send this user, or null to let them stay where they are. */
  path: string | null;
  /**
   * True when the tenant's step implies a Store that does not exist. Reported rather than
   * resumed — see the redirect-loop note below.
   */
  inconsistent: boolean;
}

/**
 * The decision, as a pure function of already-server-read facts.
 *
 * Two guards beyond the step mapping, both load-bearing:
 *
 * 1. **Only a tenant OWNER is ever resumed.** A STAFF user admitted by A11 belongs to a
 *    tenant that may still be mid-onboarding, but onboarding is not their task and every
 *    onboarding page would reject them anyway. Sending them there would be a guaranteed
 *    bounce straight back to `/home`.
 *
 * 2. **A missing Store stops the resume instead of following it.** `/onboarding/pos`
 *    redirects to `/onboarding/store` when no Store row exists, and `/onboarding/store`
 *    only accepts OWNER_CREATED — so a tenant at TEAM_INVITED with no Store would cycle
 *    `/home -> /pos -> /store -> /home` forever. That state is corrupt data, not an
 *    unfinished step (A10's readiness already calls it `inconsistent`), so the honest
 *    response is to stop and say so rather than to navigate.
 *
 *    POS_CONFIGURED is exempt: A10 detects the same corruption itself and renders a
 *    terminal "something doesn't look right" screen, so routing there is safe and gives
 *    the user a better message than `/home` can.
 */
export function resolveOnboardingResume(params: {
  tenantRole: "OWNER" | "STAFF";
  onboardingStep: string;
  hasStore: boolean;
}): OnboardingResumeDecision {
  if (params.tenantRole !== "OWNER") {
    return { path: null, inconsistent: false };
  }

  const stepImpliesStore = ["STORE_CREATED", "TEAM_INVITED", "POS_CONFIGURED"].includes(
    params.onboardingStep,
  );
  const inconsistent = stepImpliesStore && !params.hasStore;

  if (inconsistent && params.onboardingStep !== "POS_CONFIGURED") {
    return { path: null, inconsistent: true };
  }

  return { path: onboardingResumePath(params.onboardingStep), inconsistent };
}

/**
 * Read the authoritative state for this session's tenant and decide.
 *
 * Both reads are scoped by `tenantId`, which comes from the resolved session and never
 * from a request body, query string or cookie the client can shape. There is no parameter
 * here a caller could use to ask about another tenant.
 *
 * Reads only: no audit row and no outbox event. Resuming is a navigation decision derived
 * from existing state, not a state change — recording it would put noise in the
 * administrative history, and inventing a domain event for it would be speculative.
 */
export async function getOnboardingResume(params: {
  tenantId: string;
  tenantRole: "OWNER" | "STAFF";
}): Promise<OnboardingResumeDecision> {
  if (params.tenantRole !== "OWNER") {
    return { path: null, inconsistent: false };
  }

  const tenant = await db.tenant.findUnique({
    where: { id: params.tenantId },
    select: { onboardingStep: true },
  });

  // A session whose tenant row is gone is not a resumable state; let the caller render
  // normally rather than navigate somewhere that will reject them.
  if (!tenant) {
    return { path: null, inconsistent: false };
  }

  const store = await db.store.findFirst({
    where: { tenantId: params.tenantId },
    select: { id: true },
  });

  return resolveOnboardingResume({
    tenantRole: params.tenantRole,
    onboardingStep: tenant.onboardingStep,
    hasStore: store !== null,
  });
}
