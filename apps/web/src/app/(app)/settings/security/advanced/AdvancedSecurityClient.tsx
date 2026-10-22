"use client";

import { useActionState, useState } from "react";
import {
  updateStorePolicyAction,
  revokeDeviceAction,
  type AdvancedActionState,
} from "./actions";
import {
  Radio,
  Clock,
  ShieldAlert,
  Smartphone,
  Save,
  CheckCircle,
  AlertCircle,
  Lock,
} from "lucide-react";
import type { AdvancedSecuritySettings } from "@/server/identity/advancedSecurityService";

const IDLE: AdvancedActionState = { status: "idle" };

export function AdvancedSecurityClient({ settings }: { settings: AdvancedSecuritySettings }) {
  const [selectedStoreId, setSelectedStoreId] = useState(settings.stores[0]?.id || "");
  const [policyState, policyFormAction, policyPending] = useActionState(updateStorePolicyAction, IDLE);
  const [deviceState, deviceFormAction, devicePending] = useActionState(revokeDeviceAction, IDLE);

  const currentStore = settings.stores.find((s) => s.id === selectedStoreId) || settings.stores[0];

  return (
    <div className="space-y-6">
      {/* Policy Form */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Store Counter & Override Policies</h2>
              <p className="text-xs text-slate-500">
                Configure shift hold times, manager override thresholds, and counter timeout parameters.
              </p>
            </div>
          </div>
          {settings.stores.length > 1 && (
            <select
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              {settings.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          )}
        </div>

        {policyState.status === "success" && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span>{policyState.message}</span>
          </div>
        )}
        {policyState.status === "error" && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{policyState.message}</span>
          </div>
        )}

        {currentStore && (
          <form action={policyFormAction} className="mt-6 space-y-5">
            <input type="hidden" name="storeId" value={currentStore.id} />

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                <label className="block text-xs font-bold text-slate-800">
                  Held POS Bill Expiration (Hours)
                </label>
                <p className="mt-1 text-[11px] text-slate-500">
                  Bills placed on hold at the till expire after this many hours (max 24h).
                </p>
                <input
                  type="number"
                  name="heldBillHours"
                  min="1"
                  max="24"
                  defaultValue={currentStore.heldBillHours}
                  className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                <label className="block text-xs font-bold text-slate-800">
                  Late Attendance Grace Period (Minutes)
                </label>
                <p className="mt-1 text-[11px] text-slate-500">
                  Staff shift attendance grace window before recording as delayed.
                </p>
                <input
                  type="number"
                  name="lateGraceMinutes"
                  min="0"
                  max="60"
                  defaultValue={currentStore.lateGraceMinutes}
                  className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={policyPending}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-hover disabled:opacity-50 transition-colors"
              >
                <Save className="h-4 w-4" />
                {policyPending ? "Saving Policy..." : "Update Store Parameters"}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* POS Device Terminals */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Registered POS Terminals ({settings.devices.length})</h2>
              <p className="text-xs text-slate-500">
                Hardware pairing authorization and counter till locks.
              </p>
            </div>
          </div>
        </div>

        {deviceState.status === "success" && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span>{deviceState.message}</span>
          </div>
        )}

        <div className="mt-4 divide-y divide-slate-100">
          {settings.devices.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">No POS hardware devices registered.</p>
          ) : (
            settings.devices.map((device) => (
              <div key={device.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="flex items-center gap-3">
                  <Smartphone className="h-5 w-5 text-slate-400" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{device.name}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                        {device.code}
                      </span>
                      {device.isPaired ? (
                        <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                          Paired &amp; Active
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                          Awaiting Code
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Store: {device.storeName} &middot; Registered {new Date(device.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <form action={deviceFormAction}>
                  <input type="hidden" name="deviceId" value={device.id} />
                  <button
                    type="submit"
                    disabled={devicePending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-xs hover:bg-rose-50 disabled:opacity-50 transition"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    {devicePending ? "Locking..." : "Revoke Pairing"}
                  </button>
                </form>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
