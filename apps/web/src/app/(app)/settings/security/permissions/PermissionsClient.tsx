"use client";

import { useActionState, useState } from "react";
import {
  inviteStaffAction,
  updateStaffRoleAction,
  toggleStaffStatusAction,
  updateModulePermissionsAction,
  type PermissionsActionState,
} from "./actions";
import {
  UserPlus,
  Shield,
  CheckCircle,
  AlertCircle,
  Copy,
  ExternalLink,
  ChevronDown,
  UserCheck,
  UserX,
  Mail,
  Store,
} from "lucide-react";
import type { TenantStaffMember, PendingInvitationSummary } from "@/server/identity/staffPermissionsService";

const IDLE: PermissionsActionState = { status: "idle" };

const ROLE_LABELS: Record<string, { title: string; color: string }> = {
  OWNER: { title: "Owner", color: "bg-purple-100 text-purple-800 border-purple-200" },
  STORE_MANAGER: { title: "Store Manager", color: "bg-blue-100 text-blue-800 border-blue-200" },
  CASHIER: { title: "Cashier", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  SALES_ASSOCIATE: { title: "Sales Associate", color: "bg-amber-100 text-amber-800 border-amber-200" },
  INVENTORY_MANAGER: { title: "Inventory Manager", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  ACCOUNTANT: { title: "Accountant", color: "bg-teal-100 text-teal-800 border-teal-200" },
};

export function PermissionsClient({
  staff,
  pendingInvitations,
  stores,
}: {
  staff: TenantStaffMember[];
  pendingInvitations: PendingInvitationSummary[];
  stores: { id: string; name: string; code: string }[];
}) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteState, inviteFormAction, invitePending] = useActionState(inviteStaffAction, IDLE);
  const [copiedLink, setCopiedLink] = useState(false);

  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-slate-900">Active Team & Access Control</h2>
          <p className="text-xs text-slate-500">
            {staff.length} active member{staff.length === 1 ? "" : "s"} across {stores.length} store{stores.length === 1 ? "" : "s"}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowInviteModal(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-hover transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          Invite Staff Member
        </button>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900">Invite New Staff Member</h3>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form action={inviteFormAction} className="mt-4 space-y-4">
              {inviteState.status === "error" && (
                <div className="flex items-center gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{inviteState.message}</span>
                </div>
              )}
              {inviteState.status === "success" && (
                <div className="space-y-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
                    <span>{inviteState.message}</span>
                  </div>
                  {inviteState.inviteLink && (
                    <div className="mt-2 flex items-center gap-2 rounded bg-white p-2 border border-emerald-300">
                      <input
                        type="text"
                        readOnly
                        value={inviteState.inviteLink}
                        className="w-full text-[11px] bg-transparent text-slate-700 font-mono focus:outline-hidden"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(inviteState.inviteLink!);
                          setCopiedLink(true);
                          setTimeout(() => setCopiedLink(false), 2000);
                        }}
                        className="p-1 text-slate-500 hover:text-slate-800"
                        title="Copy link"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {copiedLink && <p className="text-[10px] text-emerald-600 font-medium">Link copied to clipboard!</p>}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700">Email Address</label>
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="staff@store.com"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Store Assignment</label>
                <select
                  name="storeId"
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-hidden"
                >
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Operational Role</label>
                <select
                  name="role"
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-hidden"
                >
                  <option value="CASHIER">Cashier (Till Checkout, Receipt Print)</option>
                  <option value="STORE_MANAGER">Store Manager (Discounts, Till Close, Audit)</option>
                  <option value="SALES_ASSOCIATE">Sales Associate (Orders & Inquiries)</option>
                  <option value="INVENTORY_MANAGER">Inventory Manager (Stocktakes & POs)</option>
                  <option value="ACCOUNTANT">Accountant (Ledgers & Credit)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={invitePending}
                  className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
                >
                  {invitePending ? "Sending..." : "Create Invitation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Staff Members List */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="font-bold text-slate-900 text-sm">Active Staff Members</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {staff.map((member) => (
            <StaffRow key={member.id} member={member} stores={stores} />
          ))}
        </div>
      </div>

      {/* Pending Invitations */}
      {pendingInvitations.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-sm">Pending Invitations ({pendingInvitations.length})</h3>
            <span className="text-xs text-slate-500">Awaiting acceptance</span>
          </div>
          <div className="divide-y divide-slate-100">
            {pendingInvitations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between p-4 text-xs">
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-slate-400" />
                  <div>
                    <span className="font-semibold text-slate-800">{inv.email}</span>
                    <span className="text-slate-400 ml-2">to {inv.storeName}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 border border-amber-200">
                    Role: {inv.role}
                  </span>
                  <span className="text-slate-400">
                    Expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StaffRow({
  member,
  stores,
}: {
  member: TenantStaffMember;
  stores: { id: string; name: string; code: string }[];
}) {
  const [roleState, roleFormAction, rolePending] = useActionState(updateStaffRoleAction, IDLE);
  const [statusState, statusFormAction, statusPending] = useActionState(toggleStaffStatusAction, IDLE);
  const [moduleState, moduleFormAction, modulePending] = useActionState(updateModulePermissionsAction, IDLE);
  const [isEditing, setIsEditing] = useState(false);
  const [showModuleModal, setShowModuleModal] = useState(false);

  const ALL_MODULES = [
    { id: "pos", label: "POS Counter", desc: "Ring sales, barcode scan, issue bills" },
    { id: "cash", label: "Cash & Day Close", desc: "Open floats, day-close reconciliations, cash payouts" },
    { id: "sales", label: "Sales & Invoices", desc: "View transaction records, print duplicates, process returns" },
    { id: "inventory", label: "Inventory & Stock", desc: "Stock counts, stocktakes, transfers, and adjustments" },
    { id: "products", label: "Product Catalog", desc: "Add or edit products, barcodes, prices, and GST rates" },
    { id: "customers", label: "Customers & CRM", desc: "Customer profiles, history, addresses, and loyalty" },
    { id: "khata", label: "Customer Due (Khata)", desc: "Customer credit ledgers and debt tracking" },
    { id: "purchases", label: "Purchases & Suppliers", desc: "Supplier POs, goods receipt notes, and purchase invoices" },
    { id: "reports", label: "Reports & Analytics", desc: "Financial summary, margins, and sales performance" },
    { id: "b2b", label: "B2B & Wholesale", desc: "Wholesale quotations, sales orders, and leads" },
    { id: "ai", label: "AI Insights", desc: "AI analytics and operational assistance" },
    { id: "settings", label: "Store Settings", desc: "Hardware pairing, business configuration, and policies" },
  ];

  // Default permissions based on role if no custom override
  const defaultModulesForRole = (role: string) => {
    switch (role) {
      case "STORE_MANAGER":
        return ["pos", "cash", "sales", "inventory", "products", "customers", "khata", "purchases", "reports"];
      case "CASHIER":
        return ["pos", "sales", "customers"];
      case "SALES_ASSOCIATE":
        return ["pos", "sales", "customers", "inventory"];
      case "INVENTORY_MANAGER":
        return ["inventory", "products", "purchases"];
      case "ACCOUNTANT":
        return ["cash", "sales", "khata", "reports", "purchases"];
      default:
        return ["pos", "sales"];
    }
  };

  const currentAllowed = member.customModuleAccess || defaultModulesForRole(member.stores[0]?.role || "CASHIER");
  const [selectedModules, setSelectedModules] = useState<string[]>(currentAllowed);

  const toggleModule = (id: string) => {
    if (selectedModules.includes(id)) {
      setSelectedModules(selectedModules.filter((m) => m !== id));
    } else {
      setSelectedModules([...selectedModules, id]);
    }
  };

  const isOwner = member.tenantRole === "OWNER";
  const primaryRole = isOwner ? "OWNER" : member.stores[0]?.role || "STAFF";
  const badge = ROLE_LABELS[primaryRole] || { title: primaryRole, color: "bg-slate-100 text-slate-700" };

  return (
    <div className="p-4 sm:p-5 hover:bg-slate-50/50 transition">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-xs text-slate-700">
            {member.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 text-sm">{member.name}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.color}`}>
                {badge.title}
              </span>
              {member.customModuleAccess && (
                <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                  Custom Access ({member.customModuleAccess.length} modules)
                </span>
              )}
              {member.status === "DISABLED" && (
                <span className="rounded-full bg-rose-100 border border-rose-200 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                  Disabled
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {member.email} &middot; Last login: {member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleDateString() : "Never"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isOwner && (
            <>
              <button
                type="button"
                onClick={() => setShowModuleModal(true)}
                className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100/60 shadow-xs transition"
              >
                Module Access
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs"
              >
                {isEditing ? "Close" : "Change Role"}
              </button>
              <form action={statusFormAction}>
                <input type="hidden" name="targetUserId" value={member.id} />
                <input type="hidden" name="active" value={member.status === "ACTIVE" ? "false" : "true"} />
                <button
                  type="submit"
                  disabled={statusPending}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold shadow-xs ${
                    member.status === "ACTIVE"
                      ? "border border-rose-200 text-rose-700 hover:bg-rose-50"
                      : "border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                  }`}
                >
                  {statusPending ? "..." : member.status === "ACTIVE" ? "Deactivate" : "Activate"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Granular Module Access Modal */}
      {showModuleModal && !isOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900">Custom Module Access: {member.name}</h3>
                <p className="text-xs text-slate-500">
                  Allow or restrict access to specific sections of AMBURAX for this staff member.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModuleModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form action={moduleFormAction} className="mt-4 space-y-4">
              <input type="hidden" name="targetUserId" value={member.id} />
              <input type="hidden" name="allowedModules" value={JSON.stringify(selectedModules)} />

              {moduleState.status === "success" && (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800 border border-emerald-200">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  <span>{moduleState.message}</span>
                </div>
              )}
              {moduleState.status === "error" && (
                <div className="flex items-center gap-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-800 border border-rose-200">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{moduleState.message}</span>
                </div>
              )}

              <div className="max-h-[340px] overflow-y-auto space-y-2 pr-1">
                {ALL_MODULES.map((m) => {
                  const checked = selectedModules.includes(m.id);
                  return (
                    <div
                      key={m.id}
                      onClick={() => toggleModule(m.id)}
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition ${
                        checked ? "border-blue-300 bg-blue-50/40" : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {}} // handled by div
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1 text-xs">
                        <span className="font-bold text-slate-900">{m.label}</span>
                        <p className="text-slate-500 text-[11px] mt-0.5">{m.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <span className="text-[11px] text-slate-500">
                  {selectedModules.length} of {ALL_MODULES.length} modules granted
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowModuleModal(false)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={modulePending}
                    className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
                  >
                    {modulePending ? "Saving..." : "Save Module Privileges"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Editing Role panel */}
      {isEditing && !isOwner && (
        <form action={roleFormAction} className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-3">
          <input type="hidden" name="targetUserId" value={member.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600">Store</label>
              <select
                name="storeId"
                defaultValue={member.stores[0]?.storeId || stores[0]?.id}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600">Role</label>
              <select
                name="newRole"
                defaultValue={member.stores[0]?.role || "CASHIER"}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
              >
                <option value="CASHIER">Cashier</option>
                <option value="STORE_MANAGER">Store Manager</option>
                <option value="SALES_ASSOCIATE">Sales Associate</option>
                <option value="INVENTORY_MANAGER">Inventory Manager</option>
                <option value="ACCOUNTANT">Accountant</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="submit"
              disabled={rolePending}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {rolePending ? "Saving..." : "Save Role Assignment"}
            </button>
          </div>
          {roleState.status === "error" && (
            <p className="text-xs text-rose-600">{roleState.message}</p>
          )}
        </form>
      )}

      {/* Store assignment tags */}
      {member.stores.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {member.stores.map((s) => (
            <span
              key={s.membershipId}
              className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 font-medium"
            >
              <Store className="h-3 w-3 text-slate-400" />
              {s.storeName}: <strong className="text-slate-800">{s.role}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
