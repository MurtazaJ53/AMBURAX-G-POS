"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, LogOut, Plus, Trash2 } from "lucide-react";
import {
  changePasswordAction,
  revokeOthersAction,
  revokeSessionAction,
  setIdleTimeoutAction,
  setMfaAction,
  updateSignInAlertsAction,
  updateLocationPolicyAction,
  addTrustedNetworkAction,
  removeTrustedNetworkAction,
  type SecurityActionState,
} from "./actions";

const IDLE: SecurityActionState = { status: "idle" };

const INPUT =
  "amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 transition-colors focus:border-blue-600";

function Feedback({ state }: { state: SecurityActionState }) {
  if (state.status === "idle") return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={`amb-pop-in rounded-lg px-3 py-2 text-sm ${
        state.status === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"
      }`}
    >
      {state.message}
    </p>
  );
}

/** Two-step sign-in: switch on or off, always confirmed with the account password. */
export function MfaControl({ enabled, canEnable }: { enabled: boolean; canEnable: boolean }) {
  const [state, formAction, pending] = useActionState(setMfaAction, IDLE);
  const [open, setOpen] = useState(false);
  const next = !enabled;
  const blocked = next && !canEnable;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          <span aria-hidden="true" className={`size-1.5 rounded-full ${enabled ? "bg-emerald-500" : "bg-slate-400"}`} />
          {enabled ? "On" : "Off"}
        </span>
        {!open && (
          <button
            type="button"
            disabled={blocked}
            onClick={() => setOpen(true)}
            className="amb-focus min-h-11 rounded-lg border border-blue-600 px-4 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-500 disabled:hover:bg-transparent"
          >
            {enabled ? "Turn off" : "Turn on"}
          </button>
        )}
      </div>
      {blocked && (
        <p className="text-xs text-slate-600">
          Needs an email or SMS provider to deliver one-time codes. None is connected yet, so it can&apos;t be turned on.
        </p>
      )}
      {open && (
        <form action={formAction} className="amb-pop-in space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input type="hidden" name="enabled" value={String(next)} />
          <Feedback state={state} />
          <label className="block text-sm font-medium text-slate-700">
            Confirm with your password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={(state.status === "error" && state.field === "password") || undefined}
              className={INPUT}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              aria-busy={pending}
              className="amb-focus amb-press min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {pending ? "Saving…" : enabled ? "Turn off two-step sign-in" : "Turn on two-step sign-in"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="amb-focus min-h-11 rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {!open && state.status === "success" && <Feedback state={state} />}
    </div>
  );
}

/** Sign out after a period of no activity. Enforced on the server on the next request. */
export function IdleTimeoutControl({ current, options }: { current: number | null; options: readonly number[] }) {
  const [state, formAction, pending] = useActionState(setIdleTimeoutAction, IDLE);
  const label = (m: number) => (m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : `${m / 60} hours`);
  return (
    <form action={formAction} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="idle-minutes" className="sr-only">
          Sign out after
        </label>
        <select
          id="idle-minutes"
          name="minutes"
          defaultValue={current === null ? "off" : String(current)}
          className="amb-focus min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
        >
          <option value="off">Off</option>
          {options.map((m) => (
            <option key={m} value={m}>
              After {label(m)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="amb-focus amb-press min-h-11 rounded-lg border border-blue-600 px-4 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

/** Change password while signed in. Every other device is signed out afterwards. */
export function ChangePasswordControl() {
  const [state, formAction, pending] = useActionState(changePasswordAction, IDLE);
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState(false);
  const invalid = (f: string) => (state.status === "error" && state.field === f) || undefined;
  const done = state.status === "success";

  if (!open || done) {
    return (
      <div className="space-y-3">
        {done && <Feedback state={state} />}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="amb-focus min-h-11 rounded-lg border border-blue-600 px-4 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50"
        >
          Change password
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="amb-pop-in space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <Feedback state={state} />
      <label className="block text-sm font-medium text-slate-700">
        Current password
        <input
          name="currentPassword"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          aria-invalid={invalid("currentPassword")}
          className={INPUT}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          New password
          <input
            name="newPassword"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            aria-invalid={invalid("newPassword")}
            aria-describedby="new-password-help"
            className={INPUT}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Repeat new password
          <input
            name="confirmPassword"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            aria-invalid={invalid("confirmPassword")}
            className={INPUT}
          />
        </label>
      </div>
      <p id="new-password-help" className="text-xs text-slate-600">
        At least 8 characters. Every other device will be signed out.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="amb-focus amb-press min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save new password"}
        </button>
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-pressed={show}
          className="amb-focus inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-white"
        >
          {show ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
          {show ? "Hide" : "Show"} passwords
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="amb-focus min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Sign out one session. On the current one this signs this device out. */
export function SignOutSessionButton({
  sessionId,
  label,
  isCurrent,
}: {
  sessionId: string;
  label: string;
  isCurrent: boolean;
}) {
  const [state, formAction, pending] = useActionState(revokeSessionAction, IDLE);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="sessionId" value={sessionId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={isCurrent ? "Sign out of this device" : `Sign out ${label}`}
        className="amb-focus inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-60"
      >
        <LogOut aria-hidden="true" className="h-4 w-4" />
        {pending ? "Signing out…" : isCurrent ? "Sign out here" : "Sign out"}
      </button>
      {state.status === "error" && (
        <span role="alert" className="text-xs text-rose-700">
          {state.message}
        </span>
      )}
    </form>
  );
}

/** Sign out every device except this one. */
export function SignOutOthersButton({ disabled }: { disabled: boolean }) {
  const [state, formAction, pending] = useActionState(revokeOthersAction, IDLE);
  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <button
        type="submit"
        disabled={pending || disabled}
        className="amb-focus amb-press inline-flex min-h-11 items-center gap-2 rounded-lg border border-rose-300 px-4 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500 disabled:hover:bg-transparent"
      >
        <LogOut aria-hidden="true" className="h-4 w-4" />
        {pending ? "Signing out…" : "Sign out all other devices"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** Interactive Sign-in Alerts settings component. */
export function SignInAlertsControl({
  initialEnabled,
  initialNewDeviceOnly,
  initialNotifyEmail,
  initialNotifySms,
  userEmail,
}: {
  initialEnabled: boolean;
  initialNewDeviceOnly: boolean;
  initialNotifyEmail: boolean;
  initialNotifySms: boolean;
  userEmail: string;
}) {
  const [state, formAction, pending] = useActionState(updateSignInAlertsAction, IDLE);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [newDeviceOnly, setNewDeviceOnly] = useState(initialNewDeviceOnly);
  const [notifyEmail, setNotifyEmail] = useState(initialNotifyEmail);
  const [notifySms, setNotifySms] = useState(initialNotifySms);

  return (
    <form action={formAction} className="mt-3 space-y-4">
      <input type="hidden" name="enabled" value={enabled ? "true" : "false"} />
      <input type="hidden" name="newDeviceOnly" value={newDeviceOnly ? "true" : "false"} />
      <input type="hidden" name="notifyEmail" value={notifyEmail ? "true" : "false"} />
      <input type="hidden" name="notifySms" value={notifySms ? "true" : "false"} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            enabled ? "bg-primary" : "bg-slate-200"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
        <span className="text-sm font-semibold text-slate-800">
          {enabled ? "Alerts are active" : "Alerts are turned off"}
        </span>
      </div>

      {enabled && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="space-y-2">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-600">
              When to notify
            </span>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="alertFrequency"
                checked={newDeviceOnly}
                onChange={() => setNewDeviceOnly(true)}
                className="text-primary focus:ring-primary"
              />
              <span>Only when a new or unrecognized device signs in (Recommended)</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="alertFrequency"
                checked={!newDeviceOnly}
                onChange={() => setNewDeviceOnly(false)}
                className="text-primary focus:ring-primary"
              />
              <span>On every sign-in to this account</span>
            </label>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-600">
              Delivery Channels
            </span>
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.checked)}
                  className="rounded text-primary focus:ring-primary"
                />
                <span>Email alerts to <strong>{userEmail}</strong></span>
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={notifySms}
                  onChange={(e) => setNotifySms(e.target.checked)}
                  className="rounded text-primary focus:ring-primary"
                />
                <span>Mobile SMS (Requires verified mobile number)</span>
              </label>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="amb-focus amb-press inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {pending ? "Saving preferences…" : "Save Alert Settings"}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

/** Interactive Restrict Sign-In Locations & Trusted Networks component. */
export function RestrictLocationsControl({
  isOwner,
  currentMode,
  networks,
  currentIp,
}: {
  isOwner: boolean;
  currentMode: "OFF" | "WARN" | "ENFORCE_STAFF_ONLY" | "ENFORCE_ALL";
  networks: { id: string; label: string; cidr: string }[];
  currentIp: string;
}) {
  const [policyState, policyAction, policyPending] = useActionState(updateLocationPolicyAction, IDLE);
  const [networkState, networkAction, networkPending] = useActionState(addTrustedNetworkAction, IDLE);
  const [, removeAction, removePending] = useActionState(removeTrustedNetworkAction, IDLE);

  const [labelInput, setLabelInput] = useState("");
  const [cidrInput, setCidrInput] = useState("");

  function autofillCurrentIp() {
    setLabelInput("Current Store / Office Network");
    setCidrInput(`${currentIp}/32`);
  }

  return (
    <div className="mt-3 space-y-5">
      <form action={policyAction} className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="policy-mode" className="text-sm font-semibold text-slate-800">
            Enforcement Mode:
          </label>
          <select
            id="policy-mode"
            name="mode"
            defaultValue={currentMode}
            disabled={!isOwner || policyPending}
            className="amb-focus rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
          >
            <option value="OFF">Disabled — Sign in allowed from anywhere</option>
            <option value="WARN">Alert Only — Allow sign in but flag unfamiliar locations</option>
            <option value="ENFORCE_STAFF_ONLY">Enforce on Staff — Cashiers restricted to store network</option>
            <option value="ENFORCE_ALL">Enforce on All — Strict security for entire business</option>
          </select>

          {isOwner && (
            <button
              type="submit"
              disabled={policyPending}
              className="amb-focus amb-press inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {policyPending ? "Updating…" : "Update Policy"}
            </button>
          )}
        </div>
        {!isOwner && (
          <p className="text-xs text-slate-500">Only business owners can modify location restriction policies.</p>
        )}
        <Feedback state={policyState} />
      </form>

      {/* Network List & Add Form */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Trusted Store Networks &amp; Subnets
            </h4>
            <p className="text-xs text-slate-600">
              Approved static IP addresses and CIDR ranges allowed for store access.
            </p>
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={autofillCurrentIp}
              className="text-xs font-semibold text-primary hover:underline"
            >
              + Add My Current IP ({currentIp})
            </button>
          )}
        </div>

        {/* Existing Networks */}
        <div className="mt-3 divide-y divide-slate-200">
          {networks.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">
              No specific networks added yet. (Add your store Wi-Fi / broadband IP below)
            </p>
          ) : (
            networks.map((net) => (
              <div key={net.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="font-semibold text-slate-800">{net.label}</span>
                  <code className="ml-2 rounded bg-white px-1.5 py-0.5 text-xs text-slate-700 border border-slate-200">
                    {net.cidr}
                  </code>
                </div>
                {isOwner && (
                  <form action={removeAction}>
                    <input type="hidden" name="id" value={net.id} />
                    <button
                      type="submit"
                      disabled={removePending}
                      aria-label={`Remove ${net.label}`}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </form>
                )}
              </div>
            ))
          )}
        </div>

        {/* Add Network Form */}
        {isOwner && (
          <form action={networkAction} className="mt-4 border-t border-slate-200 pt-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                name="label"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="Network label (e.g., Surat Counter Wi-Fi)"
                className="amb-focus flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                required
              />
              <input
                type="text"
                name="cidr"
                value={cidrInput}
                onChange={(e) => setCidrInput(e.target.value)}
                placeholder="IP/CIDR (e.g. 117.211.54.12/32)"
                className="amb-focus w-full sm:w-56 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                required
              />
              <button
                type="submit"
                disabled={networkPending}
                className="amb-focus amb-press inline-flex min-h-8 items-center gap-1 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
              >
                <Plus className="h-3.5 w-3.5" />
                {networkPending ? "Adding…" : "Add"}
              </button>
            </div>
            <Feedback state={networkState} />
          </form>
        )}
      </div>
    </div>
  );
}
