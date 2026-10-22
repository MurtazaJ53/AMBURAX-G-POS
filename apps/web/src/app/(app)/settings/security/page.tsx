import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { Bell, Clock, Info, KeyRound, MapPin, ShieldCheck, Timer } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolveSession } from "@/server/identity/session";
import { canEnableMfa, codeDeliveryIsLive, IDLE_TIMEOUT_OPTIONS } from "@/server/identity/securityCenter";
import { getSecurityOverview } from "@/server/identity/advancedSecurity";
import { resolveClientIp } from "@/server/security/clientIp";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { PageHeader } from "../../_components/ui";
import { SecurityNav } from "./SecurityNav";
import {
  ChangePasswordControl,
  IdleTimeoutControl,
  MfaControl,
  SignInAlertsControl,
  RestrictLocationsControl,
} from "./SecurityForms";

export const metadata: Metadata = { title: "Security settings — AMBURAX" };

/**
 * A13 — Security Settings (route /settings/security). The signed-in user's own account.
 * Enhanced with real, functional Sign-in Alerts and Location/Network Restrictions.
 */
export default async function SecuritySettingsPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let session: Awaited<ReturnType<typeof resolveSession>> = null;
  try {
    session = token ? await resolveSession(token) : null;
  } catch (err) {
    logError("security: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (!session) redirect("/auth/login");

  const mfaEnabled = session.user.mfaEnabled;
  const deliveryLive = codeDeliveryIsLive();

  let overview = {
    preferences: {
      signInAlertsEnabled: true,
      alertOnNewDeviceOnly: true,
      notifyEmail: true,
      notifySms: false,
    },
    policy: {
      enforcementMode: "OFF" as "OFF" | "WARN" | "ENFORCE_STAFF_ONLY" | "ENFORCE_ALL",
      allowedCountries: [] as string[],
      allowVpn: false,
      trustedNetworks: [] as { id: string; label: string; cidr: string; storeId: string | null; createdAt: Date }[],
    },
  };

  try {
    overview = await getSecurityOverview({
      userId: session.userId,
      tenantId: session.tenantId,
    });
  } catch (err) {
    logError("security: getSecurityOverview failed", err);
  }

  const reqHeaders = await headers();
  const currentIp = resolveClientIp(reqHeaders);
  const isOwner = session.user.tenantRole === "OWNER";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Security settings"
        subtitle="Keep your account safe. These settings apply to you only."
        breadcrumb={[{ label: "Settings", href: "/settings" }]}
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <SecurityNav active="access" />

        <section aria-labelledby="access-h" className="amb-fade-in rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 id="access-h" className="text-lg font-semibold text-slate-900">
              Login &amp; access
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">How you sign in to AMBURAX.</p>
          </div>

          <ul className="divide-y divide-slate-100">
            <li className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start">
              <ShieldCheck aria-hidden="true" className="h-6 w-6 shrink-0 text-blue-600" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-slate-900">Two-step sign-in</h3>
                <p className="mt-0.5 text-sm text-slate-600">
                  After your password, enter a one-time code sent to {session.user.email}.
                </p>
                {!deliveryLive && process.env.NODE_ENV !== "production" && (
                  <p className="mt-1 text-xs text-amber-800">Development: codes appear in the server log, not a real inbox.</p>
                )}
                <div className="mt-3">
                  <MfaControl enabled={mfaEnabled} canEnable={canEnableMfa()} />
                </div>
              </div>
            </li>

            <li className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start">
              <KeyRound aria-hidden="true" className="h-6 w-6 shrink-0 text-blue-600" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-slate-900">Password</h3>
                <p className="mt-0.5 text-sm text-slate-600">Changing it signs you out everywhere else.</p>
                <div className="mt-3">
                  <ChangePasswordControl />
                </div>
              </div>
            </li>

            <li className="flex gap-4 px-5 py-5">
              <Clock aria-hidden="true" className="h-6 w-6 shrink-0 text-blue-600" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-slate-900">Session length</h3>
                <p className="mt-0.5 text-sm text-slate-600">
                  A sign-in lasts up to {env.SESSION_TTL_HOURS} hours, then you sign in again. See and end your sessions
                  under{" "}
                  <Link href="/settings/security/sessions" className="font-semibold text-blue-700 hover:underline">
                    Sessions &amp; devices
                  </Link>
                  .
                </p>
              </div>
            </li>

            <li className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start">
              <Timer aria-hidden="true" className="h-6 w-6 shrink-0 text-blue-600" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-slate-900">Sign out when idle</h3>
                <p className="mt-0.5 text-sm text-slate-600">
                  End a session that hasn&apos;t been used for a while — useful on a shared counter computer.
                </p>
                <div className="mt-3">
                  <IdleTimeoutControl current={session.user.idleTimeoutMinutes} options={IDLE_TIMEOUT_OPTIONS} />
                </div>
              </div>
            </li>

            {/* Feature 1: Sign-in Alerts */}
            <li className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start">
              <Bell aria-hidden="true" className="h-6 w-6 shrink-0 text-blue-600" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Sign-in alerts</h3>
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    Live
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-slate-600">
                  Get notified whenever someone signs into your account from an unrecognized device or browser.
                </p>
                <SignInAlertsControl
                  initialEnabled={overview.preferences.signInAlertsEnabled}
                  initialNewDeviceOnly={overview.preferences.alertOnNewDeviceOnly}
                  initialNotifyEmail={overview.preferences.notifyEmail}
                  initialNotifySms={overview.preferences.notifySms}
                  userEmail={session.user.email}
                />
              </div>
            </li>

            {/* Feature 2: Restrict Sign-in Locations & Store Networks */}
            <li className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start">
              <MapPin aria-hidden="true" className="h-6 w-6 shrink-0 text-blue-600" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Restrict sign-in locations</h3>
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    Live
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-slate-600">
                  Protect shop floors by restricting staff and POS till logins to authorized broadband IPs and store Wi-Fi.
                </p>
                <RestrictLocationsControl
                  isOwner={isOwner}
                  currentMode={overview.policy.enforcementMode}
                  networks={overview.policy.trustedNetworks}
                  currentIp={currentIp}
                />
              </div>
            </li>
          </ul>

          <p className="flex items-start gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 text-sm text-slate-600">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            Sign-in alerts apply to your own account. Location restrictions are set by business owners for store protection.
          </p>
        </section>
      </div>
    </div>
  );
}
