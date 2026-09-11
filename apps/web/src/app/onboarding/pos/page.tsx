import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { db } from "@/server/db";
import { canConfigurePos } from "@/server/pos/posRoles";
import { PosSetupForm } from "./PosSetupForm";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";

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
    console.error("[onboarding/pos] load failed", { err });
    return <ServiceUnavailableScreen />;
  }

  if (!session) {
    redirect("/auth/login");
  }

  // Both predecessors are legitimate: a tenant that used A8's Skip sits at STORE_CREATED,
  // one that pressed Continue sits at TEAM_INVITED. Requiring only TEAM_INVITED here would
  // strand every tenant that skipped the team step.
  if (!tenant || (tenant.onboardingStep !== "STORE_CREATED" && tenant.onboardingStep !== "TEAM_INVITED")) {
    redirect("/home");
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
    redirect("/home");
  }

  // Suggestion only — the merchant can overwrite it, and the server still enforces
  // uniqueness. Not an authoritative counter.
  let suggested = "POS-01";
  for (let n = 1; n <= 99 && existingCodes.includes(suggested); n += 1) {
    suggested = `POS-${String(n + 1).padStart(2, "0")}`;
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-slate-950 p-12 text-white lg:flex">
        <div className="text-lg font-semibold tracking-tight">AMBURAX POS</div>
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold leading-tight text-white">Set up your counter.</h1>
          <p className="text-sm text-slate-300">
            Name the terminal, choose how receipts print, then pair the device that will
            run it.
          </p>
        </div>
        <p className="text-xs text-slate-400">Step 5 of 6 — POS</p>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg">
          <div className="mb-8 lg:hidden">
            <div className="text-lg font-semibold tracking-tight text-slate-900">AMBURAX POS</div>
          </div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Step 5 of 6</p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-900">Set up your POS</h2>
          <p className="mt-1 text-sm text-slate-500">
            Optional — you can add terminals later from POS Configuration.
          </p>
          <PosSetupForm
            storeId={store.id}
            storeName={store.name}
            isWarehouse={store.storeType === "WAREHOUSE"}
            suggestedCode={suggested}
          />
        </div>
      </section>
    </div>
  );
}
