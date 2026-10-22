import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext } from "@/server/sales/posContext";
import { countNeedingGst, listNeedingGst } from "@/server/catalog/gstSetup";
import { formatMinor } from "@/server/sales/saleTotals";
import { EmptyState, PageHeader, PermissionDeniedState, buttonClass } from "../../_components/ui";
import { BulkGstForm } from "./BulkGstForm";

/** Products that can't be sold until someone gives them a GST type, with a bulk setter. */
export default async function ProductGstPage(props: { searchParams: Promise<{ q?: string }> }) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token).catch((err: unknown) => {
    logError("products/gst: context failed", err);
    return null;
  });
  if (!resolved) return <ServiceUnavailableScreen />;
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;
  if (ctx.tenantRole !== "OWNER" && ctx.membershipRole !== "STORE_MANAGER") {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Set GST type" />
        <PermissionDeniedState title="Owner or store manager only" description="Ask them to set GST types for products." />
      </div>
    );
  }
  const q = (await props.searchParams).q ?? "";
  let data;
  try {
    const [rows, total] = await Promise.all([listNeedingGst({ tenantId: ctx.tenantId, q }), countNeedingGst(ctx.tenantId)]);
    data = { rows, total };
  } catch (err) {
    logError("products/gst: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="space-y-5 px-4 py-6 sm:px-6">
      <PageHeader
        title="Set GST type"
        subtitle={
          data.total === 0
            ? "Every product has a GST type."
            : `${data.total.toLocaleString("en-IN")} products can't be sold until they have a GST type. Showing up to 200 at a time.`
        }
        actions={
          <Link href="/products" className={buttonClass("secondary")}>
            Back to products
          </Link>
        }
      />
      <form className="max-w-md">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Filter by name or SKU, then press Enter"
          aria-label="Filter products"
          className="amb-focus block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
        />
      </form>
      {data.rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState title={q ? "Nothing matches" : "All set"} description={q ? "Try another name or SKU." : "No product is waiting for a GST type."} />
        </div>
      ) : (
        <BulkGstForm
          rows={data.rows.map((r) => ({
            id: r.id,
            name: r.product.name,
            sku: r.sku,
            detail: [r.size, r.colour].filter(Boolean).join(" · "),
            price: formatMinor(r.priceMinor),
          }))}
        />
      )}
    </div>
  );
}
