import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeftRight, Building2, ShieldCheck, Users } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolveSession } from "@/server/identity/session";
import { listAvailableStores, selectActiveStore, type AvailableStore } from "@/server/tenant/storeSelection";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { AuthFrame } from "@/app/_components/AuthFrame";
import { SelectStoreForm } from "./SelectStoreForm";

export const metadata: Metadata = {
  title: "Choose your store — AMBURAX",
};

/**
 * A12 — Store / Workspace Selection (SCREEN_SPECIFICATIONS.md: route /select-store; the chosen
 * store becomes the active permission and data context).
 *
 * Every sign-in lands here. With exactly one store there is nothing to choose, so the store is
 * opened straight away; `?switch=1` (from the app's store switcher) always shows the list.
 */
export default async function SelectStorePage({ searchParams }: { searchParams: Promise<{ switch?: string }> }) {
  const forceList = (await searchParams).switch === "1";
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  let session: Awaited<ReturnType<typeof resolveSession>> = null;
  let stores: AvailableStore[] = [];
  try {
    session = token ? await resolveSession(token) : null;
    if (session) {
      stores = await listAvailableStores({
        tenantId: session.tenantId,
        userId: session.userId,
        tenantRole: session.user.tenantRole === "OWNER" ? "OWNER" : "STAFF",
      });
    }
  } catch (err) {
    logError("select-store: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (!session) redirect("/auth/login");

  // An owner with no store has not finished setup; the dashboard owns that hand-off.
  if (stores.length === 0 && session.user.tenantRole === "OWNER") redirect("/dashboard");

  if (stores.length === 1 && !forceList) {
    const only = stores[0]!;
    if (session.activeStoreId !== only.id) {
      try {
        await selectActiveStore({
          sessionId: session.id,
          tenantId: session.tenantId,
          userId: session.userId,
          tenantRole: session.user.tenantRole === "OWNER" ? "OWNER" : "STAFF",
          storeId: only.id,
        });
      } catch (err) {
        logError("select-store: auto-select failed", err);
        return <ServiceUnavailableScreen />;
      }
    }
    redirect("/dashboard");
  }

  const userInitials = session.user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <AuthFrame
      wide
      headerRight={
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700"
          >
            {userInitials}
          </span>
          <span className="hidden text-sm sm:block">
            <span className="block font-semibold text-slate-900">{session.user.name}</span>
            <span className="block text-xs text-slate-600">
              {session.user.tenantRole === "OWNER" ? "Owner" : "Staff"}
            </span>
          </span>
        </div>
      }
    >
            <h2 className="text-3xl font-extrabold text-slate-900">Select your store</h2>
            <p className="mt-1 text-sm text-slate-600">
              {stores.length === 0
                ? "You aren't a member of any store yet."
                : `You can work in ${stores.length} stores. Choose the one you're working in now — you can switch any time.`}
            </p>

            <div className="mt-8">
              {stores.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-8 text-center">
                  <p className="text-sm font-semibold text-slate-900">No store access yet</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Ask your store owner to invite you, then open the invitation link from your email.
                  </p>
                  <Link
                    href="/auth/login"
                    className="amb-focus mt-4 inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-white"
                  >
                    Back to sign in
                  </Link>
                </div>
              ) : (
                <SelectStoreForm stores={stores} currentStoreId={session.activeStoreId} />
              )}
            </div>

            <ul className="mt-10 grid gap-3 border-t border-slate-100 pt-6 text-sm text-slate-600 sm:grid-cols-3">
              <li className="flex items-start gap-2">
                <Building2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                Each store has its own stock, sales and till.
              </li>
              <li className="flex items-start gap-2">
                <Users aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                Your role can differ from store to store.
              </li>
              <li className="flex items-start gap-2">
                <ArrowLeftRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                Switch stores any time from the top bar.
              </li>
            </ul>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
              Access is checked on every request, so a removed store stops working immediately.
            </p>
    </AuthFrame>
  );
}
