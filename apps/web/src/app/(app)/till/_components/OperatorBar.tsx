"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, UserRound } from "lucide-react";

/**
 * Shared counter: who is selling on this signed-in till.
 *
 * Each team member taps their name and types their own PIN; bills are then recorded under them
 * (the server keeps the choice on the session, so the browser can't name a different seller). The
 * till locks back to the signed-in user after `IDLE_LOCK_MS` without use, or on "Lock".
 * Shown only when at least one other team member has a PIN — a one-person shop never sees it.
 */

const IDLE_LOCK_MS = 5 * 60_000;

interface Staff {
  id: string;
  name: string;
  hasPin: boolean;
}

export function OperatorBar({ signedInName }: { signedInName: string }) {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [signedInId, setSignedInId] = useState<string | null>(null);
  const [current, setCurrent] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState<Staff | null>(null);
  const [panel, setPanel] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/v1/pos/operator");
        if (!res.ok) return;
        const data = await res.json();
        if (!live) return;
        setStaff(data.staff ?? []);
        setCurrent(data.current ?? null);
        setSignedInId(data.signedIn?.id ?? null);
      } catch {
        /* the bar is optional; selling works without it */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const lock = useCallback(async () => {
    setCurrent(null);
    setPanel(true);
    setPicking(null);
    try {
      await fetch("/api/v1/pos/operator", { method: "DELETE" });
    } catch {
      /* the server window also expires on its own */
    }
  }, []);

  // Idle lock: only while a PIN-chosen person is selling.
  useEffect(() => {
    if (!current) return;
    let timer = setTimeout(() => void lock(), IDLE_LOCK_MS);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void lock(), IDLE_LOCK_MS);
    };
    window.addEventListener("keydown", reset);
    window.addEventListener("pointerdown", reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", reset);
      window.removeEventListener("pointerdown", reset);
    };
  }, [current, lock]);

  useEffect(() => {
    if (picking) pinRef.current?.focus();
  }, [picking]);

  const withPin = (staff ?? []).filter((s) => s.hasPin);
  if (!staff || withPin.filter((s) => s.id !== signedInId).length === 0) return null;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!picking || pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/pos/operator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: picking.id, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? "That didn't work. Try again.");
        setPin("");
        return;
      }
      setCurrent(data.operator);
      setPanel(false);
      setPicking(null);
      setPin("");
    } catch {
      setError("No connection. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const sellingAs = current?.name ?? signedInName;

  return (
    <section aria-label="Who is selling" className="rounded-amb-lg border border-amb-line bg-amb-raised shadow-amb">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amb-accent-soft text-amb-accent">
          <UserRound aria-hidden="true" className="h-4 w-4" />
        </span>
        <p className="text-sm text-amb-ink-secondary">
          Selling as <b className="text-amb-ink">{sellingAs}</b>
        </p>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => {
              setPanel((v) => !v);
              setPicking(null);
              setError(null);
            }}
            aria-expanded={panel}
            className="amb-press min-h-touch cursor-pointer rounded-amb bg-amb-accent px-4 text-sm font-semibold text-amb-accent-ink transition-colors hover:bg-amb-accent-hover"
          >
            Switch person
          </button>
          {current && (
            <button
              type="button"
              onClick={() => void lock()}
              className="amb-press inline-flex min-h-touch cursor-pointer items-center gap-1.5 rounded-amb border border-amb-line-strong px-3 text-sm font-semibold text-amb-ink transition-colors hover:bg-amb-sunken"
            >
              <Lock aria-hidden="true" className="h-4 w-4" /> Lock
            </button>
          )}
        </div>
      </div>

      {panel && (
        <div className="amb-fade-in border-t border-amb-line px-4 py-4">
          {!picking ? (
            <>
              <p className="mb-3 text-sm font-semibold text-amb-ink">Who is selling?</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {withPin.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setPicking(s);
                      setPin("");
                      setError(null);
                    }}
                    className="amb-press min-h-touch cursor-pointer rounded-amb border border-amb-line-strong bg-amb-raised px-3 py-3 text-left text-sm font-semibold text-amb-ink transition-colors hover:bg-amb-accent-soft"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-amb-ink-muted">
                Not listed? The owner sets each person&apos;s PIN on the Staff page.
              </p>
            </>
          ) : (
            <form onSubmit={submit} className="mx-auto max-w-xs space-y-3">
              <p className="text-sm text-amb-ink">
                <b>{picking.name}</b>, type your PIN
              </p>
              <input
                ref={pinRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                aria-label={`PIN for ${picking.name}`}
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="h-14 w-full rounded-amb border-2 border-amb-line-strong bg-amb-raised text-center text-2xl tracking-[0.5em] text-amb-ink focus:border-amb-accent"
              />
              <div className="grid grid-cols-3 gap-2" aria-hidden="true">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].map((k) => (
                  <button
                    key={k}
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      if (k === "⌫") setPin((p) => p.slice(0, -1));
                      else if (k === "OK") void submit();
                      else setPin((p) => (p.length < 6 ? p + k : p));
                    }}
                    className={`amb-press h-12 cursor-pointer rounded-amb text-lg font-semibold transition-colors ${
                      k === "OK" ? "bg-amb-accent text-amb-accent-ink hover:bg-amb-accent-hover" : "bg-amb-sunken text-amb-ink hover:bg-amb-line"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
              {error && (
                <p role="alert" className="text-sm text-amb-critical">
                  {error}
                </p>
              )}
              <div className="flex justify-between text-sm">
                <button type="button" onClick={() => setPicking(null)} className="font-semibold text-amb-ink-secondary hover:text-amb-ink">
                  ← Back
                </button>
                <button type="submit" disabled={busy || pin.length < 4} className="font-semibold text-amb-accent disabled:opacity-50">
                  {busy ? "Checking…" : "Start selling"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
