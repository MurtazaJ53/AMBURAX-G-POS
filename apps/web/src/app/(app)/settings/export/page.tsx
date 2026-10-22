import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { Download } from "lucide-react";
import { Card, CardHeader, PageHeader, PermissionDeniedState } from "../../_components/ui";

const KINDS = [
  { kind: "products", title: "Products", text: "Every variant: SKU, barcode, product, category, brand, price." },
  { kind: "customers", title: "Customers", text: "Name, phone, email and GSTIN. Contains personal data — keep the file safe." },
  { kind: "sales", title: "Sales (last 90 days)", text: "Bill number, date, store, customer, cashier and amounts." },
] as const;

/** Data export (screen 78): CSV downloads for the owner. Every export is recorded in the audit log. */
export default async function ExportPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("export: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  if (ctx.tenantRole !== "OWNER") {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Export data" breadcrumb={[{ label: "Settings", href: "/settings" }]} />
        <PermissionDeniedState title="Exports are for the owner" description="Files include customer contact details." />
      </div>
    );
  }
  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <PageHeader title="Export data" subtitle="CSV files open in Excel or Google Sheets." breadcrumb={[{ label: "Settings", href: "/settings" }]} />
      <div className="grid gap-4 md:grid-cols-3">
        {KINDS.map((k) => (
          <Card key={k.kind} className="amb-fade-in amb-lift flex flex-col">
            <CardHeader title={k.title} subtitle={k.text} />
            <div className="mt-auto px-5 pb-5">
              <a
                href={`/api/v1/exports/${k.kind}`}
                download
                className="amb-focus amb-press inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover"
              >
                <Download aria-hidden="true" className="h-4 w-4" />
                Download CSV
              </a>
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-slate-500">Up to 50,000 rows per file. Each download is recorded in the audit log with who, what and how many rows.</p>
    </div>
  );
}
