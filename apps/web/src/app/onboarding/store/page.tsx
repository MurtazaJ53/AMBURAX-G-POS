import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { db } from "@/server/db";
import { StoreSetupForm } from "./StoreSetupForm";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { logError } from "@/lib/safeLog";
import { AuthFrame, ONBOARDING_STEPS } from "@/app/_components/AuthFrame";

export const metadata: Metadata = {
  title: "Set up your first store — AMBURAX POS",
};

export default async function StoreSetupPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  // Data loads only — never wrap redirect(), which Next implements by throwing.
  let session: Awaited<ReturnType<typeof resolveSession>>;
  let tenant: { onboardingStep: string } | null;
  try {
    session = token ? await resolveSession(token) : null;
    tenant = session
      ? await db.tenant.findUnique({ where: { id: session.tenantId }, select: { onboardingStep: true } })
      : null;
  } catch (err) {
    logError("onboarding/store: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (!session) {
    redirect("/auth/login");
  }

  // Only the owner, and only at the right onboarding step, ever sees this form — a
  // returning owner past this step, or a non-owner staff member (once A8 exists), lands
  // on /home instead of a form that would just reject their submission anyway.
  if (session.user.tenantRole !== "OWNER") {
    redirect("/dashboard");
  }

  if (!tenant || tenant.onboardingStep !== "OWNER_CREATED") {
    redirect("/dashboard");
  }

  return (
    <AuthFrame steps={ONBOARDING_STEPS} currentStep={3}>
          <h2 className="text-3xl font-extrabold text-slate-900">Set up your first store</h2>
          <p className="mt-1 text-sm text-slate-600">You can add more stores later.</p>
          <StoreSetupForm />
    </AuthFrame>
  );
}
