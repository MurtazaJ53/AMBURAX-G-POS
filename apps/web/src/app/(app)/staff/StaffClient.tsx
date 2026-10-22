"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, UserPlus } from "lucide-react";
import { buttonClass, Card, CardHeader, StatusBadge } from "../_components/ui";
import { ROLE_LABEL } from "./roleLabels";

const INPUT =
  "amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500";

/** Invite someone to this store (owner only — the API re-checks). Uses the A8 invitation API. */
export function InviteStaffForm({ storeId, roles }: { storeId: string; roles: readonly string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string; link?: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storeId, email: form.get("email"), role: form.get("role") }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ tone: "error", text: data?.error?.message ?? "Couldn't send the invitation." });
        return;
      }
      setMsg({ tone: "ok", text: "Invitation sent.", link: data?.devInviteLink });
      formEl.reset();
      router.refresh();
    } catch {
      setMsg({ tone: "error", text: "Couldn't reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${buttonClass("primary")} amb-press`}>
        <UserPlus aria-hidden="true" className="h-4 w-4" />
        Invite staff
      </button>
    );
  }

  return (
    <Card className="amb-pop-in w-full sm:w-[480px]">
      <CardHeader title="Invite to this store" subtitle="They get a link to create their account and join with this role." />
      <form onSubmit={onSubmit} className="space-y-4 px-5 pb-5" noValidate>
        {msg && (
          <p
            role={msg.tone === "error" ? "alert" : "status"}
            className={`amb-pop-in rounded-lg px-3 py-2 text-sm ${
              msg.tone === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"
            }`}
          >
            {msg.text}
            {msg.link && <span className="mt-1 block break-all text-xs">Development link: {msg.link}</span>}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Email
            <input name="email" type="email" required autoComplete="off" className={INPUT} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Role
            <select name="role" defaultValue="CASHIER" className={INPUT}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r] ?? r}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary")}>
            Close
          </button>
          <button type="submit" disabled={busy} aria-busy={busy} className={buttonClass("primary")}>
            <Send aria-hidden="true" className="h-4 w-4" />
            {busy ? "Sending…" : "Send invitation"}
          </button>
        </div>
      </form>
    </Card>
  );
}

/** Resend or revoke a pending invitation (owner only — the API re-checks). */
export function InvitationActions({ id, email }: { id: string; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"resend" | "revoke" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: "resend" | "revoke") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(kind === "resend" ? `/api/v1/invitations/${id}/resend` : `/api/v1/invitations/${id}`, {
        method: kind === "resend" ? "POST" : "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "That didn't work. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => act("resend")}
        disabled={busy !== null}
        aria-label={`Resend invitation to ${email}`}
        className="amb-focus min-h-11 rounded-lg px-3 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 disabled:opacity-60"
      >
        {busy === "resend" ? "Sending…" : "Resend"}
      </button>
      <button
        type="button"
        onClick={() => act("revoke")}
        disabled={busy !== null}
        aria-label={`Cancel invitation to ${email}`}
        className="amb-focus min-h-11 rounded-lg px-3 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-60"
      >
        {busy === "revoke" ? "Cancelling…" : "Cancel"}
      </button>
      {error && (
        <span role="alert" className="w-full text-right text-xs text-rose-700">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * The owner hands each team member a till PIN (shared counter): they tap their name on the Till and
 * type it to sell under their own name. Stored hashed; locks after 5 wrong tries.
 */
export function StaffPinControl({ userId, name, hasPin, isOwnerRow, isSelf }: { userId: string; name: string; hasPin: boolean; isOwnerRow: boolean; isSelf: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (isOwnerRow && !isSelf) return <span className="text-xs text-slate-500">{hasPin ? "Set" : "—"}</span>;

  async function save(value: string | null) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/pos/operator/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, pin: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data?.error?.message ?? "Couldn't save the PIN.");
        return;
      }
      setOpen(false);
      setPin("");
      router.refresh();
    } catch {
      setMsg("No connection. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <StatusBadge tone={hasPin ? "success" : "neutral"}>{hasPin ? "PIN set" : "No PIN"}</StatusBadge>
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-sky-700 hover:underline" aria-label={`${hasPin ? "Change" : "Set"} till PIN for ${name}`}>
          {hasPin ? "Change" : "Set PIN"}
        </button>
        {hasPin && (
          <button type="button" disabled={busy} onClick={() => void save(null)} className="text-xs font-semibold text-rose-700 hover:underline" aria-label={`Remove till PIN for ${name}`}>
            Remove
          </button>
        )}
      </div>
    );
  }
  return (
    <form
      className="amb-fade-in flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save(pin);
      }}
    >
      <input
        aria-label={`New till PIN for ${name}`}
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        placeholder="4–6 digits"
        className="h-9 w-28 rounded-lg border border-slate-300 px-2 text-sm tabular-nums"
      />
      <button type="submit" disabled={busy || pin.length < 4} className={`${buttonClass("primary")} h-9 px-3`}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => { setOpen(false); setMsg(null); }} className="text-xs text-slate-600">
        Cancel
      </button>
      {msg && <span role="alert" className="w-full text-xs text-rose-700">{msg}</span>}
    </form>
  );
}

export function StaffActions({
  userId,
  name,
  currentRole,
  isOwnerRow,
}: {
  userId: string;
  name: string;
  currentRole: string;
  isOwnerRow: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [selectedRole, setSelectedRole] = useState(currentRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isOwnerRow) {
    return <span className="text-xs text-slate-400 font-medium">Owner</span>;
  }

  async function updateRole(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/staff/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: selectedRole }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message || "Failed to update role");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember() {
    if (!confirm(`Are you sure you want to remove ${name} from this store?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/staff/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.message || "Failed to remove member");
        return;
      }
      router.refresh();
    } catch {
      alert("Network error");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={updateRole} className="flex items-center gap-1.5">
        <select
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value)}
          className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900"
        >
          <option value="STORE_MANAGER">Store Manager</option>
          <option value="CASHIER">Cashier</option>
          <option value="STAFF">Staff</option>
        </select>
        <button
          type="submit"
          disabled={busy}
          className="h-8 rounded-lg bg-sky-700 px-2.5 text-xs font-bold text-white hover:bg-sky-800 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          className="text-xs text-slate-500 hover:text-slate-800"
        >
          Cancel
        </button>
        {error && <span className="text-[10px] text-rose-600 block">{error}</span>}
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs font-semibold text-sky-700 hover:underline"
      >
        Change Role
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={removeMember}
        className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  );
}
