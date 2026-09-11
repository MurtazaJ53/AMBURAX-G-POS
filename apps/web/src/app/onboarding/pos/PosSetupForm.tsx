"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface Props {
  storeId: string;
  storeName: string;
  isWarehouse: boolean;
  suggestedCode: string;
}

type Banner = { tone: "error" | "info"; message: string } | null;

interface Paired {
  deviceName: string;
  deviceCode: string;
  pairingCode: string;
  pairingExpiresAt: string;
}

export function PosSetupForm({ storeId, storeName, isWarehouse, suggestedCode }: Props) {
  const router = useRouter();
  const [name, setName] = useState("Main Counter");
  const [code, setCode] = useState(suggestedCode);
  const [receiptHeader, setReceiptHeader] = useState("");
  const [receiptFooter, setReceiptFooter] = useState("");
  const [showProductImages, setShowProductImages] = useState(true);
  const [scanSoundEnabled, setScanSoundEnabled] = useState(true);
  const [cashDrawerEnabled, setCashDrawerEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [paired, setPaired] = useState<Paired | null>(null);
  const [copied, setCopied] = useState(false);

  async function post(body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    const res = await fetch("/api/v1/onboarding/pos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: (await res.json()) as Record<string, unknown> };
  }

  function reportError(data: Record<string, unknown>) {
    const err = data.error as { message?: string } | undefined;
    setBanner({ tone: "error", message: err?.message ?? "Something went wrong. Try again." });
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);

    if (name.trim().length < 2) {
      setBanner({ tone: "error", message: "Give this terminal a name, e.g. Main Counter." });
      return;
    }
    if (!/^[A-Za-z0-9-]{2,20}$/.test(code.trim())) {
      setBanner({ tone: "error", message: "Use 2-20 letters, numbers or hyphens, e.g. POS-01." });
      return;
    }

    setSubmitting(true);
    try {
      const { ok, data } = await post({
        storeId,
        name: name.trim(),
        code: code.trim(),
        receiptHeader: receiptHeader.trim() || undefined,
        receiptFooter: receiptFooter.trim() || undefined,
        showProductImages,
        scanSoundEnabled,
        cashDrawerEnabled,
      });

      if (ok && data.status === "ok") {
        const device = data.device as { name: string; code: string };
        setPaired({
          deviceName: device.name,
          deviceCode: device.code,
          pairingCode: data.pairingCode as string,
          pairingExpiresAt: data.pairingExpiresAt as string,
        });
        return;
      }
      reportError(data);
    } catch {
      setBanner({ tone: "error", message: "Can't reach the server. Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    setBanner(null);
    setSkipping(true);
    try {
      const { ok, data } = await post({ skip: true });
      if (ok && data.status === "ok") {
        router.push("/onboarding/complete");
        router.refresh();
        return;
      }
      reportError(data);
    } catch {
      setBanner({ tone: "error", message: "Can't reach the server. Check your connection and try again." });
    } finally {
      setSkipping(false);
    }
  }

  // Success panel. It deliberately does NOT say the POS is ready: the terminal exists in
  // Amburax but no physical device has claimed it yet, and saying otherwise would be the
  // exact "database row = working POS" conflation this screen has to avoid.
  if (paired) {
    const expires = new Date(paired.pairingExpiresAt);
    return (
      <div className="mt-8 space-y-5">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="font-medium">{paired.deviceName}</span> ({paired.deviceCode}) was created
          for {storeName}.
        </div>

        <div className="rounded-lg border border-slate-200 p-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Pairing code</h3>
            <span className="text-xs text-slate-500">
              Expires {expires.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <p className="mt-3 select-all break-all rounded-md bg-slate-900 px-3 py-3 font-mono text-sm tracking-wider text-white">
            {paired.pairingCode}
          </p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(paired.pairingCode).then(
                () => setCopied(true),
                () => setBanner({ tone: "error", message: "Couldn't copy. Select the code and copy it manually." }),
              );
            }}
            className="mt-2 text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            {copied ? "Copied" : "Copy code"}
          </button>
          <div
            role="alert"
            className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          >
            <span className="font-semibold">Shown once.</span> We store only a hash of this code,
            so it can&apos;t be shown again. If you lose it, create a new pairing code from POS
            Configuration.
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p className="font-medium text-slate-800">Not ready to sell yet</p>
          <p className="mt-1">
            This terminal is <span className="font-medium">awaiting pairing</span>. Open AMBURAX POS
            on the device at the counter and enter the code above. It becomes active only once the
            device has paired.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            router.push("/onboarding/complete");
            router.refresh();
          }}
          className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          Continue
        </button>
      </div>
    );
  }

  const busy = submitting || skipping;

  return (
    <form className="mt-8 space-y-6" onSubmit={handleSubmit} noValidate>
      {banner && (
        <div
          role="alert"
          aria-live="assertive"
          className={
            banner.tone === "error"
              ? "rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              : "rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
          }
        >
          {banner.message}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Terminal for <span className="font-medium text-slate-800">{storeName}</span>
        {isWarehouse && (
          <p className="mt-1 text-xs text-slate-500">
            This location is set up as a warehouse. If nobody sells over a counter here, skip
            this step.
          </p>
        )}
      </div>

      <fieldset disabled={busy} className="space-y-5">
        <legend className="sr-only">Terminal details</legend>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-slate-700">
              Terminal name
            </label>
            <input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="Main Counter"
            />
          </div>
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-slate-700">
              Terminal code
            </label>
            <input
              id="code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="POS-01"
            />
            <p className="mt-1 text-xs text-slate-400">Unique within this store.</p>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Receipt</h3>
          <div>
            <label htmlFor="receiptHeader" className="block text-sm font-medium text-slate-700">
              Header line
            </label>
            <input
              id="receiptHeader"
              value={receiptHeader}
              onChange={(e) => setReceiptHeader(e.target.value)}
              maxLength={200}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder={storeName}
            />
          </div>
          <div>
            <label htmlFor="receiptFooter" className="block text-sm font-medium text-slate-700">
              Footer line
            </label>
            <input
              id="receiptFooter"
              value={receiptFooter}
              onChange={(e) => setReceiptFooter(e.target.value)}
              maxLength={200}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="Thank you for shopping with us"
            />
          </div>
          <p className="text-xs text-slate-400">
            Invoice numbering isn&apos;t set here — your accounting system issues invoice numbers so
            they stay unique and auditable.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Counter behaviour</h3>
          {(
            [
              ["Show product images", showProductImages, setShowProductImages, "images"],
              ["Sound on scan", scanSoundEnabled, setScanSoundEnabled, "sound"],
              ["Cash drawer connected", cashDrawerEnabled, setCashDrawerEnabled, "drawer"],
            ] as const
          ).map(([label, value, set, id]) => (
            <label key={id} htmlFor={id} className="flex items-center gap-3 text-sm text-slate-700">
              <input
                id={id}
                type="checkbox"
                checked={value}
                onChange={(e) => set(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
              />
              {label}
            </label>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleSkip}
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {skipping ? "Skipping…" : "Skip for now"}
          </button>
          <button
            type="submit"
            className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create terminal"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
