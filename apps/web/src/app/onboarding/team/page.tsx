import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { db } from "@/server/db";
import { deriveInvitationStatus } from "@/server/tenant/invitation";
import { TeamInvitationForm } from "./TeamInvitationForm";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { logError } from "@/lib/safeLog";

export const metadata: Metadata = {
  title: "Invite your team — AMBURAX POS",
};

export default async function TeamInvitationPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  // Data loads only — never wrap redirect(), which Next implements by throwing.
  let session: Awaited<ReturnType<typeof resolveSession>>;
  let tenant: { onboardingStep: string } | null = null;
  let store: { id: string; name: string } | null = null;
  let invitations: Awaited<ReturnType<typeof db.invitation.findMany>> = [];
  try {
    session = token ? await resolveSession(token) : null;
    if (session) {
      tenant = await db.tenant.findUnique({ where: { id: session.tenantId }, select: { onboardingStep: true } });
      store = await db.store.findFirst({ where: { tenantId: session.tenantId }, select: { id: true, name: true } });
      invitations = await db.invitation.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { createdAt: "desc" },
      });
    }
  } catch (err) {
    logError("onboarding/team: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (!session) {
    redirect("/auth/login");
  }
  if (session.user.tenantRole !== "OWNER") {
    redirect("/dashboard");
  }

  if (!tenant || tenant.onboardingStep !== "STORE_CREATED") {
    redirect("/dashboard");
  }

  // Exactly one store exists at this point in onboarding (A7 created it, multi-store
  // screens are what make store selection meaningful) — used as the invite target
  // without asking the owner to pick from a list of one. Loaded above with everything else.

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-slate-950 p-12 text-white lg:flex">
        <div className="text-lg font-semibold tracking-tight">AMBURAX POS</div>
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold leading-tight text-white">Bring your team in.</h1>
          <p className="text-sm text-slate-300">
            Invite cashiers, managers, and staff now — or skip and do it later from Team
            Settings.
          </p>
        </div>
        <p className="text-xs text-slate-400">Step 4 of 6 — Team</p>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg">
          <div className="mb-8 lg:hidden">
            <div className="text-lg font-semibold tracking-tight text-slate-900">AMBURAX POS</div>
          </div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Step 4 of 6</p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-900">Invite your team</h2>
          <p className="mt-1 text-sm text-slate-500">
            Optional — you can always invite people later.
          </p>
          <TeamInvitationForm
            storeId={store?.id ?? null}
            storeName={store?.name ?? null}
            initialInvitations={invitations.map((inv) => ({
              id: inv.id,
              email: inv.email,
              role: inv.role,
              status: deriveInvitationStatus(inv),
              expiresAt: inv.expiresAt.toISOString(),
            }))}
          />
        </div>
      </section>
    </div>
  );
}
