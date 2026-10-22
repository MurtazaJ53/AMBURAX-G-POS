import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolveSession } from "@/server/identity/session";
import { listAuditEntries, type AuditEntry } from "@/server/identity/securityCenter";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { PageHeader } from "../../../_components/ui";
import { formatDateTime } from "../../../sales/formatDateTime";
import { SecurityNav } from "../SecurityNav";

export const metadata: Metadata = { title: "Audit logs — AMBURAX" };

/**
 * A13 "Audit logs": the trail every important action already writes. The business owner sees the
 * whole business; anyone else sees only their own actions. Read-only, newest first, 50 per page.
 */
export default async function AuditLogPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const beforeRaw = (await searchParams).before;
  const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : null;
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  let session: Awaited<ReturnType<typeof resolveSession>> = null;
  let page: { entries: AuditEntry[]; nextBefore: Date | null } = { entries: [], nextBefore: null };
  try {
    session = token ? await resolveSession(token) : null;
    if (session) {
      page = await listAuditEntries({
        tenantId: session.tenantId,
        userId: session.userId,
        tenantRole: session.user.tenantRole === "OWNER" ? "OWNER" : "STAFF",
        before,
      });
    }
  } catch (err) {
    logError("audit: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (!session) redirect("/auth/login");
  const isOwner = session.user.tenantRole === "OWNER";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Audit logs"
        subtitle={isOwner ? "Every recorded action across your business." : "Every recorded action you've taken."}
        breadcrumb={[
          { label: "Settings", href: "/settings" },
          { label: "Security", href: "/settings/security" },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <SecurityNav active="audit" />
        <section aria-labelledby="audit-h" className="amb-fade-in overflow-hidden rounded-xl border border-slate-200 bg-white">
          <h2 id="audit-h" className="sr-only">
            Audit entries
          </h2>
          {page.entries.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-600">
              {before ? "No older entries." : "Nothing recorded yet."}
            </p>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <caption className="sr-only">Audit entries, newest first</caption>
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-600">
                  <tr>
                    <th scope="col" className="px-5 py-3">
                      When
                    </th>
                    <th scope="col" className="px-5 py-3">
                      What
                    </th>
                    {isOwner && (
                      <th scope="col" className="px-5 py-3">
                        Who
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {page.entries.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap px-5 py-3 tabular-nums text-slate-600">{formatDateTime(e.at)}</td>
                      <td className="px-5 py-3">
                        <span className="font-medium text-slate-900">{e.label}</span>
                        <span className="block font-mono text-[11px] text-slate-500">{e.action}</span>
                      </td>
                      {isOwner && <td className="px-5 py-3 text-slate-700">{e.actorName ?? "System"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-between gap-2 border-t border-slate-100 px-5 py-3">
            {before ? (
              <Link
                href="/settings/security/audit"
                className="amb-focus inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
              >
                Newest
              </Link>
            ) : (
              <span />
            )}
            {page.nextBefore && (
              <Link
                href={`/settings/security/audit?before=${encodeURIComponent(page.nextBefore.toISOString())}`}
                className="amb-focus inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
              >
                Older entries
              </Link>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
