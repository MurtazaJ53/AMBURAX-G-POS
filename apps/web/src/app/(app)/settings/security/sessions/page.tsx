import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { KeyRound, LogIn, LogOut, Monitor, ShieldAlert, Smartphone, Store, Tablet } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolveSession } from "@/server/identity/session";
import {
  listActiveSessions,
  recentSecurityActivity,
  type ActiveSession,
  type SecurityEvent,
} from "@/server/identity/securityCenter";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { PageHeader } from "../../../_components/ui";
import { formatDateTime } from "../../../sales/formatDateTime";
import { SecurityNav } from "../SecurityNav";
import { SignOutOthersButton, SignOutSessionButton } from "../SecurityForms";

export const metadata: Metadata = { title: "Sessions & devices — AMBURAX" };

const DEVICE_ICON = { desktop: Monitor, mobile: Smartphone, tablet: Tablet, unknown: Monitor } as const;

const EVENT_STYLE: Record<SecurityEvent["kind"], { icon: typeof LogIn; tone: string }> = {
  login_ok: { icon: LogIn, tone: "text-emerald-600" },
  login_failed: { icon: ShieldAlert, tone: "text-rose-600" },
  signed_out: { icon: LogOut, tone: "text-slate-500" },
  password_changed: { icon: KeyRound, tone: "text-blue-600" },
  mfa_changed: { icon: KeyRound, tone: "text-blue-600" },
  store_switched: { icon: Store, tone: "text-slate-500" },
};

/**
 * A14 — Sessions / Devices (route /settings/security/sessions). The user's own active sessions,
 * each signable-out on its own, plus "sign out everywhere else", and recent sign-in activity.
 * Only the row id identifies a session to the browser; no token or hash ever leaves the server.
 */
export default async function SessionsPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let session: Awaited<ReturnType<typeof resolveSession>> = null;
  let sessions: ActiveSession[] = [];
  let activity: SecurityEvent[] = [];
  try {
    session = token ? await resolveSession(token) : null;
    if (session) {
      [sessions, activity] = await Promise.all([
        listActiveSessions({ userId: session.userId, tenantId: session.tenantId, currentSessionId: session.id }),
        recentSecurityActivity({
          userId: session.userId,
          tenantId: session.tenantId,
          email: session.user.email,
          limit: 10,
        }),
      ]);
    }
  } catch (err) {
    logError("sessions: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (!session) redirect("/auth/login");

  const others = sessions.filter((s) => !s.isCurrent).length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Sessions & devices"
        subtitle="Where you're signed in. Sign out anything you don't recognise."
        breadcrumb={[
          { label: "Settings", href: "/settings" },
          { label: "Security", href: "/settings/security" },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <SecurityNav active="sessions" />

        <div className="space-y-6">
          <section aria-labelledby="sessions-h" className="amb-fade-in rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 id="sessions-h" className="text-lg font-semibold text-slate-900">
                  Active sessions ({sessions.length})
                </h2>
                <p className="mt-0.5 text-sm text-slate-600">Devices currently signed in to your account.</p>
              </div>
              <SignOutOthersButton disabled={others === 0} />
            </div>
            <ul className="divide-y divide-slate-100">
              {sessions.map((s) => {
                const Icon = DEVICE_ICON[s.device.kind];
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                    <Icon aria-hidden="true" className="h-7 w-7 shrink-0 text-slate-500" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                        {s.device.label}
                        {s.isCurrent && (
                          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                            This device
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-600">
                        {[s.storeName, s.ip ? `IP ${s.ip}` : null].filter(Boolean).join(" · ") || "No location recorded"}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Signed in {formatDateTime(s.createdAt)} · ends {formatDateTime(s.expiresAt)}
                      </p>
                    </div>
                    <SignOutSessionButton sessionId={s.id} label={s.device.label} isCurrent={s.isCurrent} />
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="activity-h" className="amb-fade-in rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 id="activity-h" className="text-lg font-semibold text-slate-900">
                Recent activity
              </h2>
              <p className="mt-0.5 text-sm text-slate-600">Your latest sign-ins and security changes.</p>
            </div>
            {activity.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-600">No activity recorded yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {activity.map((e, i) => {
                  const style = EVENT_STYLE[e.kind];
                  return (
                    <li key={`${e.kind}-${e.at.toISOString()}-${i}`} className="flex items-center gap-4 px-5 py-3">
                      <style.icon aria-hidden="true" className={`h-5 w-5 shrink-0 ${style.tone}`} />
                      <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">{e.label}</span>
                      <span className="shrink-0 text-right text-xs text-slate-600">
                        <span className="block">{formatDateTime(e.at)}</span>
                        {e.ip && <span className="block">IP {e.ip}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
