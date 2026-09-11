import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { SignOutButton } from "./SignOutButton";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";

export default async function HomePage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  // Only the data load is wrapped, never the redirect below: Next implements redirect()
  // by throwing, so catching around it would swallow the navigation.
  let session: Awaited<ReturnType<typeof resolveSession>>;
  try {
    session = token ? await resolveSession(token) : null;
  } catch (err) {
    console.error("[home] session resolution failed", { err });
    return <ServiceUnavailableScreen />;
  }

  if (!session) {
    redirect("/auth/login");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Signed in as</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">{session.user.name}</p>
        <p className="text-sm text-slate-500">{session.user.email}</p>
        <p className="mt-4 text-xs uppercase tracking-wide text-slate-400">Tenant</p>
        <p className="text-sm text-slate-700">{session.tenantId}</p>
        <p className="mt-6 text-sm text-slate-500">
          A1 (Login) is wired end to end. The dashboard workspace (screen 15) is not built yet.
        </p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
