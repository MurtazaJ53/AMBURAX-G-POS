import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Building2 } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { formatPhone } from "@/lib/customerFields";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import {
  canManageSuppliers,
  countSuppliers,
  listSuppliers,
  SUPPLIER_PAGE_SIZE,
  type SupplierRow,
} from "@/server/purchasing/suppliers";
import { DataTable, EmptyState, PageHeader, SearchForm, Td, Th } from "../_components/ui";
import { AddSupplierButton, SupplierRowActions } from "./SupplierForm";

/**
 * Suppliers — the directory that purchasing will build on.
 *
 * Only directory data exists. Purchase orders, goods receipts, cost prices and supplier
 * balances are not built, and this screen shows none of them rather than empty columns that
 * look like zero.
 */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const query = (sp.q ?? "").slice(0, 100);
  const status = sp.status === "inactive" ? "inactive" : "active";

  // Read outside the try so Next always sees this page is per-user.
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("suppliers: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let rows: SupplierRow[];
  let counts: { active: number; inactive: number };
  try {
    [rows, counts] = await Promise.all([
      listSuppliers({ tenantId: ctx.tenantId, query, status }),
      countSuppliers(ctx.tenantId),
    ]);
  } catch (err) {
    logError("suppliers: list failed", err);
    return <ServiceUnavailableScreen />;
  }

  const canManage = canManageSuppliers(ctx);
  const tabs = [
    { id: "active", label: "Active", count: counts.active },
    { id: "inactive", label: "Inactive", count: counts.inactive },
  ] as const;

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Suppliers"
        subtitle="Who you buy stock from. Record goods received from them under Purchases."
        actions={canManage ? <AddSupplierButton /> : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Supplier status" className="flex rounded-lg bg-slate-100 p-0.5">
          {tabs.map((t) => {
            const active = t.id === status;
            const params = new URLSearchParams();
            if (query) params.set("q", query);
            if (t.id === "inactive") params.set("status", "inactive");
            const qs = params.toString();
            return (
              <Link
                key={t.id}
                href={`/suppliers${qs ? `?${qs}` : ""}`}
                aria-current={active ? "page" : undefined}
                className={`amb-focus inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold transition-colors ${
                  active ? "bg-white text-sky-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {t.label}
                <span className="ml-1.5 tabular-nums text-slate-500">{t.count}</span>
              </Link>
            );
          })}
        </nav>
        <div className="min-w-[240px] flex-1">
          <SearchForm
            action="/suppliers"
            label="Search suppliers"
            placeholder="Name, contact, phone, GSTIN or city"
            defaultValue={query}
            hiddenFields={status === "inactive" ? { status: "inactive" } : undefined}
          />
        </div>
      </div>

      {!canManage && (
        <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          You can view suppliers. Only an owner or store manager can add or change them.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState
            icon={<Building2 className="h-5 w-5" />}
            title={
              query
                ? `No ${status} supplier matches "${query}"`
                : status === "inactive"
                  ? "No inactive suppliers"
                  : "No suppliers yet"
            }
            description={
              query
                ? "Check the spelling, or search by phone or GSTIN."
                : status === "inactive"
                  ? "Suppliers you deactivate appear here."
                  : canManage
                    ? "Add the businesses you buy stock from."
                    : "An owner or store manager can add suppliers."
            }
          />
        </div>
      ) : (
        <>
          <DataTable caption={`${status === "inactive" ? "Inactive" : "Active"} suppliers`}>
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th>Contact</Th>
                <Th>GSTIN</Th>
                <Th>City</Th>
                {canManage && <Th align="right">Actions</Th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link href={`/suppliers/${s.id}`} className="amb-focus font-semibold text-slate-900 hover:text-sky-700 hover:underline">
                      {s.name}
                    </Link>
                    {s.notes && (
                      <span className="mt-0.5 block max-w-xs truncate text-xs text-slate-500" title={s.notes}>
                        {s.notes}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="block text-slate-700">{s.contactName ?? "—"}</span>
                    <span className="block text-xs text-slate-500">
                      {[s.phone ? formatPhone(s.phone) : null, s.email].filter(Boolean).join(" · ") ||
                        "No phone or email"}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-slate-700">{s.gstin ?? "—"}</span>
                  </Td>
                  <Td>{s.city ?? "—"}</Td>
                  {canManage && (
                    <Td align="right">
                      <SupplierRowActions supplier={s} />
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </DataTable>
          {rows.length === SUPPLIER_PAGE_SIZE && (
            <p className="mt-3 text-sm text-slate-500">
              Showing the first {SUPPLIER_PAGE_SIZE}. Search to narrow the list.
            </p>
          )}
        </>
      )}
    </div>
  );
}
