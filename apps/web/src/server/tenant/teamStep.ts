import { db } from "@/server/db";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { isIpRateLimited } from "@/server/identity/loginGuard";
import { writeAuditLog } from "@/server/identity/audit";

export type CompleteTeamStepResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited" }
  | { status: "already_completed" }
  | { status: "ok" };

/**
 * A8 owns exactly one onboarding transition: STORE_CREATED -> TEAM_INVITED. Deliberately a
 * separate operation from creating an invitation — the A8 wireframe has both a "Skip" and
 * a "Continue" button, which settles an otherwise-ambiguous product question: TEAM_INVITED
 * means "the team step was explicitly completed," not "at least one invitation exists."
 * Zero invitations plus Skip is a fully supported path. See DECISIONS.md for the reasoning.
 *
 * Same atomic-claim shape as A6/A7 (ADR-042/ADR-049): a conditional `updateMany` is the
 * only write, so two concurrent calls can only have one winner and there's no multi-step
 * transaction to roll back.
 */
export async function completeTeamStep(params: {
  sessionToken: string;
  ip: string;
  correlationId: string;
}): Promise<CompleteTeamStepResult> {
  const session = await resolveSession(params.sessionToken);
  if (!session) {
    return { status: "unauthorized" };
  }

  if (
    await isIpRateLimited(params.ip, "team_step", {
      windowMs: 60 * 60 * 1000,
      threshold: env.TEAM_STEP_MAX_PER_WINDOW,
    })
  ) {
    return { status: "rate_limited" };
  }

  if (session.user.tenantRole !== "OWNER") {
    return { status: "forbidden" };
  }

  const claimed = await db.tenant.updateMany({
    where: { id: session.tenantId, onboardingStep: "STORE_CREATED" },
    data: { onboardingStep: "TEAM_INVITED" },
  });

  if (claimed.count === 0) {
    return { status: "already_completed" };
  }

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "OnboardingStepAdvanced",
    correlationId: params.correlationId,
    metadata: { from: "STORE_CREATED", to: "TEAM_INVITED" },
  });

  return { status: "ok" };
}
