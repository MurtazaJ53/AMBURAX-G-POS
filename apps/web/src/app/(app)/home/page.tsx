import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { SignOutButton } from "../SignOutButton";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { logError } from "@/lib/safeLog";
import { getOnboardingResume } from "@/server/onboarding/resume";

export default async function HomePage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  // Only the data load is wrapped, never the redirect below: Next implements redirect()
  // by throwing, so catching around it would swallow the navigation.
  let session: Awaited<ReturnType<typeof resolveSession>>;
  let resume: Awaited<ReturnType<typeof getOnboardingResume>> = { path: null, inconsistent: false };
  try {
    session = token ? await resolveSession(token) : null;
    if (session) {
      resume = await getOnboardingResume({
        tenantId: session.tenantId,
        tenantRole: session.user.tenantRole,
      });
    }
  } catch (err) {
    logError("home: session resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (!session) {
    redirect("/auth/login");
  }

  // P1-5. Every authenticated entry path lands here — sign-in, MFA completion, the root
  // redirect, a bookmark, a refresh — so this one server-side guard is what makes an
  // interrupted owner resume instead of dead-ending on the placeholder below.
  //
  // The decision comes from the authoritative Tenant row, never from the client, and is
  // null for a completed tenant, so onboarding is never restarted.
  if (resume.path) {
    redirect(resume.path);
  }

  // A fully set-up tenant now has somewhere real to be, so /home lands on the till rather
  // than on a placeholder saying the workspace does not exist yet. Every authenticated
  // entry path routes through here, so this is the one place that needs to change.
  //
  // The inconsistent state below must not be redirected past: it is the only screen that
  // explains why setup cannot continue, and bouncing through it would hide the reason.
  if (!resume.inconsistent) {
    redirect("/pos");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Signed in as</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">{session.user.name}</p>
        <p className="text-sm text-slate-500">{session.user.email}</p>
        {/*
          Reached only when the tenant's step implies a Store that does not exist. Resuming
          would loop (/pos -> /store -> /home -> /pos), so the guard deliberately stops
          here. Saying so is the difference between failing safely and failing silently —
          without this the owner sees a placeholder and no reason why setup never continues.
        */}
        <div
          role="alert"
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Your setup is in an unexpected state and we can&apos;t safely continue it from
          here. Please contact support — nothing you&apos;ve entered has been lost.
        </div>

        <div className="mt-6">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
