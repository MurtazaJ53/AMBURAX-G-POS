"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "STORE_MANAGER", label: "Store Manager" },
  { value: "SALES_ASSOCIATE", label: "Sales Associate" },
  { value: "CASHIER", label: "Cashier" },
  { value: "INVENTORY_MANAGER", label: "Inventory Manager" },
  { value: "ACCOUNTANT", label: "Accountant" },
];

const ROLE_LABELS: Record<string, string> = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));

interface InvitationRow {
  id: string;
  email: string;
  role: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expiresAt: string;
}

const STATUS_STYLES: Record<InvitationRow["status"], string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  ACCEPTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REVOKED: "bg-slate-100 text-slate-500 border-slate-200",
  EXPIRED: "bg-slate-100 text-slate-500 border-slate-200",
};

interface Props {
  storeId: string | null;
  storeName: string | null;
  initialInvitations: InvitationRow[];
}

type Banner = { tone: "error" | "info"; message: string } | null;

export function TeamInvitationForm({ storeId, storeName, initialInvitations }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(ROLE_OPTIONS[0]!.value);
  const [invitations, setInvitations] = useState<InvitationRow[]>(initialInvitations);
  const [banner, setBanner] = useState<Banner>(null);
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState<"skip" | "continue" | null>(null);

  async function handleInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);
    if (!storeId) {
      setBanner({ tone: "error", message: "No store found to invite people to yet." });
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setBanner({ tone: "error", message: "Enter a valid email address." });
      return;
    }

    setInviting(true);
    try {
      const res = await fetch("/api/v1/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, email: email.trim(), role }),
      });
      const data = await res.json();

      if (res.ok && data.status === "ok") {
        setInvitations((prev) => [
          { id: data.invitation.id, email: data.invitation.email, role: data.invitation.role, status: "PENDING", expiresAt: data.invitation.expiresAt },
          ...prev.filter((i) => i.email !== data.invitation.email),
        ]);
        setEmail("");
        setBanner({ tone: "info", message: `Invitation sent to ${data.invitation.email}.` });
        return;
      }

      setBanner({ tone: "error", message: data.error?.message ?? "Couldn't send the invitation." });
    } catch {
      setBanner({ tone: "error", message: "Can't reach the server. Check your connection and try again." });
    } finally {
      setInviting(false);
    }
  }

  async function handleResend(id: string) {
    setBusyId(id);
    setBanner(null);
    try {
      const res = await fetch(`/api/v1/invitations/${id}/resend`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.status === "ok") {
        setInvitations((prev) => prev.map((i) => (i.id === id ? { ...i, status: "PENDING", expiresAt: data.expiresAt } : i)));
        setBanner({ tone: "info", message: "Invitation resent." });
      } else {
        setBanner({ tone: "error", message: data.error?.message ?? "Couldn't resend the invitation." });
      }
    } catch {
      setBanner({ tone: "error", message: "Can't reach the server. Check your connection and try again." });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRevoke(id: string) {
    setBusyId(id);
    setBanner(null);
    try {
      const res = await fetch(`/api/v1/invitations/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.status === "ok") {
        setInvitations((prev) => prev.map((i) => (i.id === id ? { ...i, status: "REVOKED" } : i)));
      } else {
        setBanner({ tone: "error", message: data.error?.message ?? "Couldn't revoke the invitation." });
      }
    } catch {
      setBanner({ tone: "error", message: "Can't reach the server. Check your connection and try again." });
    } finally {
      setBusyId(null);
    }
  }

  async function handleFinish(kind: "skip" | "continue") {
    setFinishing(kind);
    setBanner(null);
    try {
      const res = await fetch("/api/v1/onboarding/team/complete", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.status === "ok") {
        router.push("/onboarding/pos");
        router.refresh();
        return;
      }
      if (data.error?.code === "already_completed") {
        router.push("/onboarding/pos");
        return;
      }
      setBanner({ tone: "error", message: data.error?.message ?? "Something went wrong. Try again." });
    } catch {
      setBanner({ tone: "error", message: "Can't reach the server. Check your connection and try again." });
    } finally {
      setFinishing(null);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      {banner && (
        <div
          role="alert"
          aria-live="assertive"
          className={
            banner.tone === "error"
              ? "rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              : "rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          }
        >
          {banner.message}
        </div>
      )}

      <form onSubmit={handleInvite} className="space-y-4" noValidate>
        <div className="grid grid-cols-[1fr_auto_auto] gap-3">
          <div>
            <label htmlFor="invite-email" className="sr-only">
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@business.com"
              disabled={inviting || !storeId}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="sr-only">
              Role
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={inviting || !storeId}
              className="block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={inviting || !storeId}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {inviting ? "Sending…" : "Invite"}
          </button>
        </div>
        {storeName && <p className="text-xs text-slate-400">Invites access to {storeName}.</p>}
      </form>

      {invitations.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invitations.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-4 py-2 text-slate-900">{inv.email}</td>
                  <td className="px-4 py-2 text-slate-600">{ROLE_LABELS[inv.role] ?? inv.role}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[inv.status]}`}>
                      {inv.status[0]}{inv.status.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {(inv.status === "PENDING" || inv.status === "EXPIRED") && (
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => handleResend(inv.id)}
                          disabled={busyId === inv.id}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-60"
                        >
                          Resend
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRevoke(inv.id)}
                          disabled={busyId === inv.id}
                          className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-60"
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => handleFinish("skip")}
          disabled={finishing !== null}
          className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {finishing === "skip" ? "Skipping…" : "Skip for now"}
        </button>
        <button
          type="button"
          onClick={() => handleFinish("continue")}
          disabled={finishing !== null}
          className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {finishing === "continue" ? "Continuing…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
