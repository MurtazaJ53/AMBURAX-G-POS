import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { db } from "@/server/db";
import { canConfigurePos } from "@/server/pos/posRoles";
import { PosSetupForm } from "./PosSetupForm";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { logError } from "@/lib/safeLog";
import { AuthFrame, ONBOARDING_STEPS } from "@/app/_components/AuthFrame";

export const metadata: Metadata = {
  title: "Set up your POS — AMBURAX POS",
};

export default async function PosSetupPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  // Data loads only — never wrap redirect(), which Next implements by throwing, so a
  // catch around it would swallow the navigation and render the fallback instead.
  let session: Awaited<ReturnType<typeof resolveSession>>;
  let tenant: { onboardingStep: string } | null = null;
  let store: { id: string; name: string; storeType: "RETAIL" | "WAREHOUSE" } | null = null;
  let membership: { role: string } | null = null;
  let existingCodes: string[] = [];
  try {
    session = token ? await resolveSession(token) : null;
    if (session) {
      tenant = await db.tenant.findUnique({
        where: { id: session.tenantId },
        select: { onboardingStep: true },
      });
      store = await db.store.findFirst({
        where: { tenantId: session.tenantId },
        select: { id: true, name: true, storeType: true },
      });
      if (store) {
        membership = await db.storeMembership.findUnique({
          where: { userId_storeId: { userId: session.userId, storeId: store.id } },
          select: { role: true },
        });
        existingCodes = (
          await db.posDevice.findMany({ where: { storeId: store.id }, select: { code: true } })
        ).map((d) => d.code);
      }
    }
  } catch (err) {
    logError("onboarding/pos: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (!session) {
    redirect("/auth/login");
  }

  // Both predecessors are legitimate: a tenant that used A8's Skip sits at STORE_CREATED,
  // one that pressed Continue sits at TEAM_INVITED. Requiring only TEAM_INVITED here would
  // strand every tenant that skipped the team step.
  if (!tenant || (tenant.onboardingStep !== "STORE_CREATED" && tenant.onboardingStep !== "TEAM_INVITED")) {
    redirect("/dashboard");
  }

  // Exactly one store exists during onboarding (A7 created it). Multi-store selection is
  // A12's job — this is not a store picker, it is "the store you just set up".
  if (!store) {
    redirect("/onboarding/store");
  }

  // The same check the server runs on submit. This one only decides what to render —
  // hiding the form is not the authorization, `createFirstPosDevice` is.
  if (
    !canConfigurePos({
      tenantRole: session.user.tenantRole,
      storeBelongsToTenant: true,
      membershipRole: membership?.role ?? null,
    })
  ) {
    redirect("/dashboard");
  }

  // Suggestion only — the merchant can overwrite it, and the server still enforces
  // uniqueness. Not an authoritative counter.
  let suggested = "POS-01";
  for (let n = 1; n <= 99 && existingCodes.includes(suggested); n += 1) {
    suggested = `POS-${String(n + 1).padStart(2, "0")}`;
  }

  return (
    <AuthFrame steps={ONBOARDING_STEPS} currentStep={5} wide>
          <h2 className="text-3xl font-extrabold text-slate-900">Set up your POS</h2>
          <p className="mt-1 text-sm text-slate-600">
            Optional — you can add terminals later from POS Configuration.
          </p>
          <PosSetupForm
            storeId={store.id}
            storeName={store.name}
            isWarehouse={store.storeType === "WAREHOUSE"}
            suggestedCode={suggested}
          />
    </AuthFrame>
  );
}
