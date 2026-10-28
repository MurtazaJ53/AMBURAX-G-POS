import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Monitor, ShieldCheck } from "lucide-react";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { Card, PageHeader, PermissionDeniedState, buttonClass } from "../_components/ui";
import { CompanyCreditDefault } from "./CompanyCreditDefault";
import { GstSlabSettings } from "./GstSlabSettings";
import { ApprovalPinSettings } from "./ApprovalPinSettings";
import { AiSettings } from "./AiSettings";
import { aiKeyStatus } from "@/server/ai/aiKey";
import { hasApprovalPin } from "@/server/identity/approvalPin";
import { getApparelSlab } from "@/server/tax/taxSettings";
import { getVarianceAccounts } from "@/server/pos/varianceAccounts";
import { VarianceAccounts } from "./VarianceAccounts";

export default async function SettingsPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("settings: context resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/dashboard");

  const isOwner = resolved.context.tenantRole === "OWNER";
  const canApprove = isOwner || resolved.context.membershipRole === "STORE_MANAGER";
  let slab = null;
  let pinSet = false;
  let ai: Awaited<ReturnType<typeof aiKeyStatus>> | null = null;
  let variance: Awaited<ReturnType<typeof getVarianceAccounts>> | null = null;
  try {
    if (isOwner) slab = await getApparelSlab(resolved.context.tenantId);
    variance = await getVarianceAccounts({
      tenantId: resolved.context.tenantId,
      userId: resolved.context.userId,
      tenantRole: resolved.context.tenantRole,
      storeId: resolved.context.storeId,
    });
    pinSet = await hasApprovalPin(resolved.context.userId);
    if (isOwner) ai = await aiKeyStatus(resolved.context.tenantId);
  } catch (err) {
    logError("settings: read failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <PageHeader
        title="Store & Settings"
        subtitle="Manage GST, company credit defaults and selling devices."
        actions={
          isOwner ? (
            <Link href="/settings/import" className={buttonClass("secondary")}>
              Import data
            </Link>
          ) : undefined
        }
      />

      <ApprovalPinSettings hasPin={pinSet} canApprove={canApprove} />

      {isOwner && ai && (
        <AiSettings
          set={ai.set}
          last4={ai.last4}
          geminiSet={ai.geminiSet}
          geminiLast4={ai.geminiLast4}
          openaiSet={ai.openaiSet}
          openaiLast4={ai.openaiLast4}
          storageReady={ai.storageReady}
        />
      )}

      {isOwner && slab && <GstSlabSettings slab={slab} />}

      {variance?.status === "ok" && (
        <VarianceAccounts
          companyName={variance.company.name}
          cash={variance.company.erpCashAccount}
          overShort={variance.company.erpCashOverShortAccount}
          waiting={variance.waiting}
        />
      )}

      <nav aria-label="More settings" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { href: "/settings/company", title: "Company", text: "Legal company, read from accounting" },
          { href: "/settings/pos", title: "POS configuration", text: "Held bills and attendance rules" },
          { href: "/settings/system-health", title: "System health", text: "What has synced to accounting" },
          { href: "/settings/export", title: "Export data", text: "CSV of products, customers, sales" },
          { href: "/settings/import", title: "Import data", text: "Migrate inventory, customers, past sales" },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="amb-focus amb-lift rounded-xl border border-slate-200 bg-white p-4 hover:border-sky-300">
            <span className="block text-sm font-semibold text-slate-900">{l.title}</span>
            <span className="mt-1 block text-xs text-slate-600">{l.text}</span>
          </Link>
        ))}
      </nav>

      {resolved.context.tenantRole === "OWNER" ? (
        <CompanyCreditDefault />
      ) : (
        <PermissionDeniedState
          title="Owner access required"
          description="Only the business owner can view or change the company Udhar default."
        />
      )}

      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-slate-100 p-2 text-slate-600"><ShieldCheck aria-hidden="true" className="h-5 w-5" /></span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Security &amp; sign-in</h2>
            <p className="mt-1 text-sm text-slate-600">Password, two-step sign-in, and the devices you&apos;re signed in on.</p>
          </div>
        </div>
        <Link href="/settings/security" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Open security <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-slate-100 p-2 text-slate-600"><Monitor aria-hidden="true" className="h-5 w-5" /></span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">POS Terminals</h2>
            <p className="mt-1 text-sm text-slate-500">Manage registered selling devices for your active store.</p>
          </div>
        </div>
        <Link href="/settings/terminals" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Manage terminals <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </Card>
    </div>
  );
}
