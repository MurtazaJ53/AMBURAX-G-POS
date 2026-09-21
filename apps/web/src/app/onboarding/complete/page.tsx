import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { getOnboardingReadiness, type ReadinessResult } from "@/server/onboarding/readiness";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { OnboardingCompleteView } from "./OnboardingCompleteView";
import { logError } from "@/lib/safeLog";

export const metadata: Metadata = {
  title: "Setup complete — AMBURAX POS",
};

export default async function OnboardingCompletePage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  // Data loads only — never wrap redirect(), which Next implements by throwing (ADR-069).
  let session: Awaited<ReturnType<typeof resolveSession>>;
  let result: ReadinessResult | null = null;
  try {
    session = token ? await resolveSession(token) : null;
    if (session && session.user.tenantRole === "OWNER") {
      result = await getOnboardingReadiness({ tenantId: session.tenantId, userId: session.userId });
    }
  } catch (err) {
    logError("onboarding/complete: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (!session) {
    redirect("/auth/login");
  }

  // Finishing the tenant's setup is an owner action, consistent with A8's and A9's step
  // transitions. A STAFF user created by A11 has a workspace to go to, not a setup to end.
  if (session.user.tenantRole !== "OWNER") {
    redirect("/dashboard");
  }

  if (!result || result.status === "unauthorized" || result.status === "forbidden") {
    redirect("/dashboard");
  }

  if (result.status === "inconsistent") {
    return (
      <Shell>
        <h2 className="text-2xl font-semibold text-slate-900">Something doesn&apos;t look right</h2>
        <div
          role="alert"
          className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          Your setup is in an unexpected state and we&apos;d rather tell you than guess. Please
          contact support — nothing you&apos;ve entered has been lost.
        </div>
      </Shell>
    );
  }

  const { readiness } = result;

  // A tenant that has not reached the POS step yet has no business on the final screen;
  // send them to the step they are actually on rather than showing a checklist of things
  // they have not done. A tenant already at COMPLETE stays — revisiting the summary is
  // legitimate, and redirecting away would make the screen unreachable after finishing.
  if (!readiness.onboardingComplete && !readiness.canComplete) {
    redirect("/dashboard");
  }

  return (
    <Shell>
      <OnboardingCompleteView readiness={readiness} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-slate-950 p-12 text-white lg:flex">
        <div className="text-lg font-semibold tracking-tight">AMBURAX POS</div>
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold leading-tight text-white">That&apos;s the setup done.</h1>
          <p className="text-sm text-slate-300">
            Here&apos;s exactly what&apos;s working and what&apos;s still waiting — no surprises at
            the counter.
          </p>
        </div>
        <p className="text-xs text-slate-400">Step 6 of 6 — Complete</p>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg">
          <div className="mb-8 lg:hidden">
            <div className="text-lg font-semibold tracking-tight text-slate-900">AMBURAX POS</div>
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}
