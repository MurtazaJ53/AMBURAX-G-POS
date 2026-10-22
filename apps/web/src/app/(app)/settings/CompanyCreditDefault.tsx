"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/client/platform/apiClient";
import { buttonClass, Card, CardHeader, ErrorState, LoadingState } from "../_components/ui";
import type { CreditModeValue } from "@/server/khata/creditMode";

interface SettingResponse {
  setting: {
    companyName: string;
    currency: string;
    mode: CreditModeValue;
    limitMinor: number | null;
  };
}

function toInputAmount(minor: number | null): string {
  if (minor === null) return "";
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

function parseInputAmount(raw: string): number | null {
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(raw.trim());
  if (!match) return null;
  try {
    const fractional = (match[2] ?? "").padEnd(2, "0");
    const minor = BigInt(match[1]!) * 100n + BigInt(fractional || "0");
    if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(minor);
  } catch {
    return null;
  }
}

export function CompanyCreditDefault() {
  const [setting, setSetting] = useState<SettingResponse["setting"] | null>(null);
  const [mode, setMode] = useState<CreditModeValue>("BLOCKED");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const result = await apiRequest<SettingResponse>("/api/v1/settings/credit-default");
    if (result.ok) {
      setSetting(result.data.setting);
      setMode(result.data.setting.mode);
      setAmount(toInputAmount(result.data.setting.limitMinor));
    } else if (result.kind === "api") {
      setError(result.message || "Could not load company credit settings.");
    } else {
      setError("Could not load company credit settings. Check your connection and retry.");
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const save = async () => {
    setError(null);
    setSuccess(null);
    const limitMinor = mode === "LIMITED" ? parseInputAmount(amount) : null;
    if (mode === "LIMITED" && limitMinor === null) {
      setError("Enter a positive amount with no more than two decimal places.");
      return;
    }

    setSaving(true);
    const result = await apiRequest<SettingResponse>("/api/v1/settings/credit-default", {
      method: "POST",
      body: { mode, limitMinor },
    });
    setSaving(false);
    if (result.ok) {
      setSetting(result.data.setting);
      setMode(result.data.setting.mode);
      setAmount(toInputAmount(result.data.setting.limitMinor));
      setSuccess("Company default saved. Existing customer accounts were not changed.");
    } else if (result.kind === "api") {
      setError(result.message || "Could not save company credit settings.");
    } else {
      setError("The save outcome is unknown. Reload settings before trying again.");
    }
  };

  if (loading) return <LoadingState label="Loading company credit default..." />;
  if (!setting && error) return <ErrorState title="Company credit settings unavailable" description={error} action={<button type="button" onClick={() => void load()} className={buttonClass("secondary")}>Retry</button>} />;

  return (
    <Card>
      <CardHeader
        title="New customer Udhar default"
        subtitle={setting ? `${setting.companyName} · ${setting.currency}` : undefined}
      />
      <div className="space-y-5 p-5">
        <p className="text-sm text-slate-600">
          This default is copied when a customer&apos;s company credit account is first created. Changing it does not change existing customer accounts. Udhar checkout remains unavailable until the complete credit workflow is enabled.
        </p>

        <div className="max-w-xl">
          <label htmlFor="credit-default-mode" className="mb-1.5 block text-sm font-medium text-slate-700">Default access for new customer accounts</label>
          <select
            id="credit-default-mode"
            value={mode}
            onChange={(event) => { setMode(event.target.value as CreditModeValue); setSuccess(null); }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="BLOCKED">Blocked — no Udhar</option>
            <option value="UNLIMITED">Unlimited — no numeric cap</option>
            <option value="LIMITED">Limited — enforce a credit limit</option>
          </select>
        </div>

        {mode === "LIMITED" && (
          <div className="max-w-sm">
            <label htmlFor="credit-default-limit" className="mb-1.5 block text-sm font-medium text-slate-700">Credit limit ({setting?.currency}, major units)</label>
            <input
              id="credit-default-limit"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => { setAmount(event.target.value); setSuccess(null); }}
              placeholder="For example, 10000.00"
              aria-describedby="credit-limit-help"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <p id="credit-limit-help" className="mt-1.5 text-xs text-slate-500">Enter a positive amount. It is stored in integer minor units.</p>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}

        <button type="button" onClick={() => void save()} disabled={saving} className={buttonClass("primary")}>
          {saving ? "Saving..." : "Save default"}
        </button>
      </div>
    </Card>
  );
}
