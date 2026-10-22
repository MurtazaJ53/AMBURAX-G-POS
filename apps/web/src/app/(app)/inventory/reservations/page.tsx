import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Lock } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { listReservations } from "@/server/inventory/reservations";
import { DataTable, EmptyState, KpiCard, PageHeader, StatusBadge, Td, Th } from "../../_components/ui";
import { formatDateOnly, formatTime } from "../../sales/formatDateTime";
import { ReviewForm } from "./ReviewForm";

/**
 * Stock reservations (screen 36): units held for confirmed orders and live online checkouts in
 * this store. Order reservations are reviewed after 7 days — renewed or released by a person.
 */
export default async function ReservationsPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("reservations: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let rows: Awaited<ReturnType<typeof listReservations>>;
  try {
    rows = await listReservations({ tenantId: ctx.tenantId, storeId: ctx.storeId });
  } catch (err) {
    logError("reservations: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  const manager =
    ctx.tenantRole === "OWNER" || ctx.membershipRole === "STORE_MANAGER" || ctx.membershipRole === "INVENTORY_MANAGER";
  const due = rows.filter((r) => r.reviewDue).length;

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Reservations"
        subtitle={`Stock held in ${ctx.storeName}. Held stock can't be sold at the till.`}
        breadcrumb={[{ label: "Inventory", href: "/inventory" }]}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Units held" value={String(rows.reduce((s, r) => s + r.quantity, 0))} hint={`${rows.length} reservations`} />
        <KpiCard
          label="For orders"
          value={String(rows.filter((r) => r.source === "ORDER").length)}
          hint="Kept until delivered or released"
          tone="violet"
        />
        <KpiCard label="Need review" value={String(due)} hint="Order holds older than 7 days" tone={due > 0 ? "amber" : "blue"} />
      </div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState icon={<Lock className="h-5 w-5" />} title="Nothing held" description="Reserving a confirmed order holds its stock here." />
        </div>
      ) : (
        <DataTable caption="Active reservations">
          <thead>
            <tr>
              <Th>Item</Th>
              <Th align="right">Units</Th>
              <Th>For</Th>
              <Th>Until</Th>
              <Th align="right">
                <span className="sr-only">Review</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  <span className="font-medium text-slate-900">{r.name}</span>
                  <span className="block font-mono text-xs text-slate-500">{r.sku}</span>
                </Td>
                <Td align="right" className="tabular-nums">
                  {r.quantity}
                </Td>
                <Td>{r.source === "ORDER" ? `Order ${r.orderNumber ?? ""}` : "Online checkout"}</Td>
                <Td>
                  {r.source === "CHECKOUT" && r.expiresAt ? (
                    `${formatTime(r.expiresAt)} (15-minute hold)`
                  ) : r.reviewDue ? (
                    <StatusBadge tone="warning">Review due</StatusBadge>
                  ) : r.reviewAt ? (
                    `Review ${formatDateOnly(r.reviewAt)}`
                  ) : (
                    "—"
                  )}
                </Td>
                <Td align="right">{manager && r.source === "ORDER" ? <ReviewForm id={r.id} label={r.name} /> : null}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
