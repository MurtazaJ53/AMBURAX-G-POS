import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Users } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import {
  getCustomerSegments,
  isSegment,
  isSegmentWindow,
  SEGMENT_WINDOWS,
  SEGMENTS,
  type Segment,
  type SegmentWindow,
} from "@/server/sales/customerSegments";
import { DataTable, EmptyState, PageHeader, StatusBadge, Td, Th } from "../../_components/ui";
import { formatDateOnly } from "../../sales/formatDateTime";

const LABEL: Record<Segment, string> = { new: "New", active: "Active", lapsed: "Lapsed", never: "Never bought" };
const HINT: Record<Segment, string> = {
  new: "First bill in this window",
  active: "Bought in this window, and before",
  lapsed: "Bought before, not in this window",
  never: "No completed bill yet",
};
const TONE: Record<Segment, "success" | "info" | "warning" | "neutral"> = {
  new: "success",
  active: "info",
  lapsed: "warning",
  never: "neutral",
};
const TYPE_LABEL: Record<string, string> = { RETAIL: "Retail", WHOLESALE: "Wholesale", DISTRIBUTOR: "Distributor" };

const tab = (active: boolean) =>
  `amb-focus inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold transition-colors ${
    active ? "bg-white text-sky-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
  }`;

/** Customer segments (screen 40): who is new, active, lapsed or yet to buy, over a window you choose. */
export default async function SegmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; segment?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const requested = Number(sp.days);
  const days: SegmentWindow = isSegmentWindow(requested) ? requested : 90;
  const segment = sp.segment && isSegment(sp.segment) ? sp.segment : undefined;
  const sort = sp.sort === "visits" ? "visits" : "spend";
  const href = (o: { days?: number; segment?: Segment | null; sort?: string }) => {
    const q = new URLSearchParams({ days: String(o.days ?? days), sort: o.sort ?? sort });
    const s = o.segment === undefined ? segment : o.segment;
    if (s) q.set("segment", s);
    return `/customers/segments?${q}`;
  };

  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("segments: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let data: Awaited<ReturnType<typeof getCustomerSegments>>;
  try {
    data = await getCustomerSegments({ tenantId: ctx.tenantId, days, segment, sort });
  } catch (err) {
    logError("segments: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Customer segments"
        subtitle={`${data.total.toLocaleString("en-IN")} active customers, grouped by when they last bought — over the last ${days} days.`}
        breadcrumb={[{ label: "Customers", href: "/customers" }]}
      />

      <nav aria-label="Window" className="mb-5 flex w-fit flex-wrap rounded-lg bg-slate-100 p-0.5">
        {SEGMENT_WINDOWS.map((d) => (
          <Link key={d} href={href({ days: d })} aria-current={d === days ? "page" : undefined} className={tab(d === days)}>
            {d} days
          </Link>
        ))}
      </nav>

      <ul className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Segments">
        {SEGMENTS.map((s, i) => {
          const active = segment === s;
          return (
            <li key={s} className="cust-rise" style={{ ["--i" as string]: i }}>
              <Link
                href={href({ segment: active ? null : s })}
                aria-current={active ? "true" : undefined}
                className={`amb-focus amb-lift block rounded-xl border bg-white p-4 shadow-sm ${
                  active ? "border-sky-400 ring-2 ring-sky-100" : "border-slate-200 hover:border-sky-200"
                }`}
              >
                <span className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">{LABEL[s]}</span>
                  <StatusBadge tone={TONE[s]}>{data.counts[s].toLocaleString("en-IN")}</StatusBadge>
                </span>
                <span className="mt-1 block text-xs text-slate-500">{HINT[s]}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {Object.keys(data.byType).length > 1 && (
        <DataTable caption="Segments by customer type">
          <thead>
            <tr>
              <Th>Type</Th>
              {SEGMENTS.map((s) => (
                <Th key={s} align="right">
                  {LABEL[s]}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.byType).map(([type, c]) => (
              <tr key={type}>
                <Td>{TYPE_LABEL[type] ?? type}</Td>
                {SEGMENTS.map((s) => (
                  <Td key={s} align="right" className="tabular-nums">
                    {c[s]}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">
          {segment ? LABEL[segment] : "All customers"} · by {sort === "visits" ? "bills" : "spend"} in {days} days
        </h2>
        <nav aria-label="Sort" className="flex rounded-lg bg-slate-100 p-0.5">
          <Link href={href({ sort: "spend" })} aria-current={sort === "spend" ? "page" : undefined} className={tab(sort === "spend")}>
            Spend
          </Link>
          <Link href={href({ sort: "visits" })} aria-current={sort === "visits" ? "page" : undefined} className={tab(sort === "visits")}>
            Bills
          </Link>
        </nav>
      </div>

      {data.customers.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState icon={<Users className="h-5 w-5" />} title="No one here" description="No customer falls in this segment for this window." />
        </div>
      ) : (
        <DataTable caption="Customers in segment">
          <thead>
            <tr>
              <Th>Customer</Th>
              <Th>Segment</Th>
              <Th align="right">Bills</Th>
              <Th align="right">Spent</Th>
              <Th>Last bought</Th>
            </tr>
          </thead>
          <tbody>
            {data.customers.map((c) => (
              <tr key={c.id}>
                <Td>
                  <Link href={`/customers/${c.id}`} className="amb-focus rounded font-medium text-slate-900 hover:text-sky-700 hover:underline">
                    {c.name}
                  </Link>
                  <span className="block text-xs text-slate-500">{TYPE_LABEL[c.customerType] ?? c.customerType}</span>
                </Td>
                <Td>
                  <StatusBadge tone={TONE[c.segment]}>{LABEL[c.segment]}</StatusBadge>
                </Td>
                <Td align="right" className="tabular-nums">
                  {c.billsInWindow}
                </Td>
                <Td align="right" className="tabular-nums">
                  {c.spentInWindowMinor > 0 ? formatMinor(c.spentInWindowMinor) : "—"}
                </Td>
                <Td>{c.lastPurchaseAt ? formatDateOnly(c.lastPurchaseAt) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <p className="mt-4 text-xs text-slate-500">
        Spend is completed bills in the window, before refunds. The window is yours to choose; no &ldquo;top&rdquo; or
        &ldquo;lapsed&rdquo; rule is fixed until the owner decides one.
      </p>
    </div>
  );
}
