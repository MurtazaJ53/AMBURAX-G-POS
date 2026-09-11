import { db } from "@/server/db";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { isIpRateLimited } from "@/server/identity/loginGuard";
import { writeAuditLog } from "@/server/identity/audit";
import { getOnboardingReadiness, type OnboardingReadiness } from "@/server/onboarding/readiness";

/**
 * A10 owns exactly one onboarding transition: POS_CONFIGURED -> COMPLETE.
 *
 * Completion is deliberately **intent-based, not readiness-gated**. The merchant pressing
 * "Enter workspace" is the event being recorded; it means "I finished the setup sequence",
 * not "every downstream integration works". Gating it on `operationalReady` would make
 * onboarding literally uncompletable today — payments and ERPNext stock are UNAVAILABLE
 * platform-wide (see readiness.ts) — and would conflate a record of the user's actions with
 * a statement about the system. A10 reports readiness honestly and lets them in anyway.
 *
 * Both A8 paths reach here identically, because A9 already normalized them: whether the
 * tenant skipped the team step (STORE_CREATED -> POS_CONFIGURED) or completed it
 * (TEAM_INVITED -> POS_CONFIGURED), it arrives at POS_CONFIGURED and this transition is the
 * same. A10 therefore needs no A8-awareness of its own.
 */

export type CompleteOnboardingResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited" }
  | { status: "wrong_step"; onboardingStep: string }
  | { status: "already_complete"; readiness: OnboardingReadiness }
  | { status: "ok"; readiness: OnboardingReadiness };

export async function completeOnboarding(params: {
  sessionToken: string;
  ip: string;
  correlationId: string;
}): Promise<CompleteOnboardingResult> {
  const session = await resolveSession(params.sessionToken);
  if (!session) {
    return { status: "unauthorized" };
  }

  if (
    await isIpRateLimited(params.ip, "onboarding_complete", {
      windowMs: 60 * 60 * 1000,
      threshold: env.ONBOARDING_COMPLETE_MAX_PER_WINDOW,
    })
  ) {
    return { status: "rate_limited" };
  }

  // Finishing onboarding is a tenant-level decision, consistent with A8's and A9's skip
  // transitions. A STAFF user created by A11 has no business completing their employer's
  // setup, and this is enforced server-side, not by hiding the button.
  if (session.user.tenantRole !== "OWNER") {
    await writeAuditLog({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "OnboardingCompletionForbidden",
      correlationId: params.correlationId,
    });
    return { status: "forbidden" };
  }

  // The claim is the whole transition: one conditional statement, so two tabs or a
  // double-click can only have one winner and there is no multi-step transaction to roll
  // back. `onboardingStep: "POS_CONFIGURED"` in the WHERE is also what makes this
  // non-regressive — a tenant already at COMPLETE matches zero rows and is never moved
  // backwards, and a tenant at an earlier step cannot skip ahead to COMPLETE from here.
  const claimed = await db.tenant.updateMany({
    where: { id: session.tenantId, onboardingStep: "POS_CONFIGURED" },
    data: { onboardingStep: "COMPLETE", onboardingCompletedAt: new Date() },
  });

  const readiness = await getOnboardingReadiness({
    tenantId: session.tenantId,
    userId: session.userId,
  });

  if (claimed.count === 0) {
    // Either already COMPLETE (the common case: refresh, back button, second tab) or
    // genuinely at an earlier step. Distinguished by reading the authoritative state rather
    // than by guessing, so a real out-of-order attempt is not silently reported as success.
    if (readiness.status === "ok" && readiness.readiness.onboardingComplete) {
      return { status: "already_complete", readiness: readiness.readiness };
    }
    return {
      status: "wrong_step",
      onboardingStep: readiness.status === "ok" ? readiness.readiness.onboardingStep : "UNKNOWN",
    };
  }

  // Written only by the winner, so a refresh produces no second row. This is an audit
  // entry, not a published domain event — ADR-010's outbox does not exist, so nothing
  // downstream reacts to onboarding finishing.
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "OnboardingCompleted",
    correlationId: params.correlationId,
    metadata: {
      from: "POS_CONFIGURED",
      to: "COMPLETE",
      // Recorded because it is the interesting fact: onboarding finished while the system
      // was not yet operationally ready. Support will want this when a merchant asks why
      // they cannot sell.
      operationalReady: readiness.status === "ok" ? readiness.readiness.operationalReady : null,
    },
  });

  if (readiness.status !== "ok") {
    // The transition committed; only the follow-up read failed. Reporting failure here
    // would tell the merchant onboarding did not finish when it did.
    return {
      status: "ok",
      readiness: {
        onboardingStep: "COMPLETE",
        onboardingComplete: true,
        operationalReady: false,
        canComplete: false,
        items: [],
        businessName: "",
        storeName: null,
      },
    };
  }

  return { status: "ok", readiness: readiness.readiness };
}
