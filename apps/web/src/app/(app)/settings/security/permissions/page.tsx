import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { listTenantStaff } from "@/server/identity/staffPermissionsService";
import { PageHeader } from "../../../_components/ui";
import { SecurityNav } from "../SecurityNav";
import { PermissionsClient } from "./PermissionsClient";
import { Shield, Check } from "lucide-react";

export const metadata: Metadata = { title: "User permissions — AMBURAX" };

export default async function PermissionsPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (!session) redirect("/auth/login");

  const { staff, pendingInvitations, stores } = await listTenantStaff(session.tenantId);

  const roleSpecs = [
    {
      name: "Owner",
      badge: "Full Access",
      desc: "Unrestricted control over business setup, stores, banking, settings, and staff.",
      permissions: [
        "Manage business profile and stores",
        "View and edit company accounting & GST",
        "Invite, edit and remove staff",
        "Manage POS terminals and approve all overrides",
        "Access executive reports and analytics",
      ],
    },
    {
      name: "Store Manager",
      badge: "Store Operations",
      desc: "Oversees shifts, day-close reconciliations, inventory audits, and cashier overrides.",
      permissions: [
        "Open and close till shifts",
        "Approve cashier discounts with PIN",
        "Conduct stocktakes and stock transfers",
        "View store-level sales and operational KPIs",
      ],
    },
    {
      name: "Cashier",
      badge: "Counter Till",
      desc: "Fast point-of-sale checkout, customer lookups, and receipt printing.",
      permissions: [
        "Scan barcodes and build carts",
        "Accept Cash, UPI, Card, and split payments",
        "Issue bills and return receipts",
        "Switch operators securely by PIN",
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="User permissions"
        subtitle="Role-based access control, active team members, and system authority levels."
        breadcrumb={[
          { label: "Settings", href: "/settings" },
          { label: "Security", href: "/settings/security" },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <SecurityNav active="permissions" />
        <section className="space-y-6">
          <PermissionsClient
            staff={staff}
            pendingInvitations={pendingInvitations}
            stores={stores}
          />

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Role-Based Access Hierarchy</h2>
                <p className="text-xs text-slate-500">
                  Every user account is guarded by verified tenant tokens and strict role boundaries.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {roleSpecs.map((r) => (
                <div key={r.name} className="flex flex-col rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-900">{r.name}</h3>
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                      {r.badge}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">{r.desc}</p>
                  <ul className="mt-4 space-y-2 border-t border-slate-200/60 pt-3 text-xs text-slate-700">
                    {r.permissions.map((p) => (
                      <li key={p} className="flex items-start gap-1.5">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
