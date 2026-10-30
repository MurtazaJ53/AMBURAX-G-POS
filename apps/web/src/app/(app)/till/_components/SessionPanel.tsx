"use client";

import Link from "next/link";
import { useState } from "react";
import type { SessionState } from "@/client/pos/session";
import type { PosDevice } from "@/client/pos/types";
import { formatMinor } from "@/server/sales/saleTotals";
import type { DeviceState, OpeningCashState } from "./useTill";
import { Button, Chip, Field, inputClass, Panel } from "./primitives";
import { ErrorBanner } from "./ErrorBanner";
import { PairTerminal } from "./PairTerminal";

/**
 * Starting, running and ending a shift.
 *
 * ## The start of a shift is three steps, shown as three steps
 *
 * 1. **Terminal** — remembered on this computer, chosen once, or set up in one click.
 * 2. **Opening cash** — what is in the drawer now. Pre-filled with the cash counted when this
 *    terminal last closed, because that is almost always what is still there; the cashier confirms
 *    or corrects it. Recorded once per shift (`setOpeningFloat`), the figure Cash & Day Close
 *    reconciles against.
 * 3. **Start selling.**
 *
 * The opening cash never blocks a sale: if it can't be loaded or saved, the shift still opens and
 * the panel offers to record it again, so a flaky connection doesn't stop the queue.
 *
 * ## Ending a shift
 *
 * "Count cash & close" goes to Cash & Day Close, where the drawer is counted against what was
 * sold. The quick close here takes only a handover note and leaves the count for later.
 *
 * ## Resume
 *
 * A reloaded browser is the same shift, not a second one, and the panel says "resumed" rather
 * than implying a new shift began.
 */

/** "1,500.50" → 150050 paise. Null when it isn't a non-negative amount. */
export function parseRupees(text: string): number | null {
  const cleaned = text.replace(/[,\s₹]/g, "");
  if (cleaned === "") return null;
  if (!/^\d{1,9}(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

function rupeesText(minor: number | null): string {
  if (minor == null) return "";
  return (minor / 100).toFixed(minor % 100 === 0 ? 0 : 2);
}

function Step({
  n,
  title,
  done,
  current,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      <span
        aria-hidden="true"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors duration-200 ${
          done
            ? "bg-amb-positive text-white"
            : current
              ? "bg-amb-accent text-amb-accent-ink"
              : "bg-amb-sunken text-amb-ink-muted"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className={`text-sm font-semibold ${current || done ? "text-amb-ink" : "text-amb-ink-muted"}`}>
          {title}
          {done && <span className="sr-only"> (done)</span>}
        </p>
        {(current || done) && <div className="amb-fade-in mt-2">{children}</div>}
      </div>
    </li>
  );
}

/** The way forward when there is no terminal to choose: terminals are set up in Settings. */
function SetUpTerminalLink() {
  return (
    <Link
      href="/settings/terminals"
      className="amb-press inline-flex min-h-touch items-center rounded-amb border border-amb-line-strong bg-amb-raised px-4 text-sm font-semibold text-amb-ink hover:bg-amb-sunken"
    >
      Set up a terminal
    </Link>
  );
}

function DevicePicker({
  devices,
  selectedId,
  onSelect,
}: {
  devices: PosDevice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const usable = devices.filter((device) => device.status === "ACTIVE");
  const unusable = devices.filter((device) => device.status !== "ACTIVE");

  if (devices.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-amb-ink-secondary">
          This store has no terminals yet. An owner or store manager adds one in Settings → POS
          Terminals.
        </p>
        <SetUpTerminalLink />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {usable.length > 0 && (
        <fieldset>
          <legend className="sr-only">Terminal</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {usable.map((device) => (
              <button
                key={device.id}
                type="button"
                onClick={() => onSelect(device.id)}
                aria-pressed={device.id === selectedId}
                className={`amb-press min-h-touch cursor-pointer rounded-amb border px-4 py-3 text-left transition-colors duration-150 ${
                  device.id === selectedId
                    ? "border-amb-accent bg-amb-accent-soft"
                    : "border-amb-line-strong bg-amb-raised hover:bg-amb-sunken"
                }`}
              >
                <span className="block text-sm font-semibold text-amb-ink">{device.code}</span>
                <span className="block text-xs text-amb-ink-muted">{device.name}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {unusable.length > 0 && (
        <ul className="space-y-1 rounded-amb border border-amb-line bg-amb-sunken px-3 py-2">
          {unusable.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-amb-ink-secondary">
                {device.code} · {device.name}
              </span>
              {/* Named precisely, because "unavailable" sends the operator to the wrong
                  person. Pairing is a setup task; disabled is an owner's decision. */}
              <Chip tone={device.status === "DISABLED" ? "critical" : "caution"}>
                {device.status === "DISABLED"
                  ? "Disabled"
                  : device.status === "PAIRING_EXPIRED"
                    ? "Pairing expired"
                    : "Not paired"}
              </Chip>
            </li>
          ))}
        </ul>
      )}

      {unusable.some((device) => device.status !== "DISABLED") && (
        <PairTerminal devices={unusable.filter((device) => device.status !== "DISABLED")} />
      )}
    </div>
  );
}

function OpeningCashInput({
  id,
  value,
  onChange,
  hint,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  hint: string;
}) {
  const invalid = value.trim() !== "" && parseRupees(value) === null;
  return (
    <Field label="Opening cash in drawer (₹)" hint={invalid ? "Enter an amount like 2000 or 1500.50" : hint}>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-amb-ink-muted">
          ₹
        </span>
        <input
          id={id}
          className={`${inputClass} amb-tnum pl-7 text-lg font-semibold`}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0"
        />
      </div>
    </Field>
  );
}

export function SessionPanel({
  devices,
  selectedDevice,
  onSelectDevice,
  session,
  opening,
  onOpen,
  onRecordOpening,
  onClose,
  onDismiss,
}: {
  devices: DeviceState;
  selectedDevice: PosDevice | null;
  onSelectDevice: (id: string) => void;
  session: SessionState;
  opening: OpeningCashState;
  onOpen: (openingMinor: number | null) => void;
  onRecordOpening: (sessionId: string, amountMinor: number) => void;
  onClose: (note: string) => void;
  onDismiss: () => void;
}) {
  const [note, setNote] = useState("");
  // `null` = the cashier hasn't typed; show the suggestion. Typing takes over.
  const [cashTyped, setCashTyped] = useState<string | null>(null);
  const cashText = cashTyped ?? rupeesText(opening.suggestedMinor);
  const cashMinor = parseRupees(cashText);
  const cashHint =
    opening.suggestedMinor != null
      ? `Filled in from the cash counted at the last close${
          opening.fromClosedAt ? ` (${new Date(opening.fromClosedAt).toLocaleDateString()})` : ""
        }. Change it if the drawer differs.`
      : "Count the notes and coins in the drawer before the first sale.";

  const canStart =
    session.phase === "no_session" || session.phase === "closed" || session.phase === "unknown";

  if (session.phase === "active") {
    const sessionId = session.session.id;
    const needsCash = opening.phase === "ready" && opening.recordedMinor == null;
    return (
      <Panel title="Shift" className="p-4">
        <div className="space-y-4 p-1">
          <p className="text-sm text-amb-ink-secondary">
            {session.resumed
              ? "Your shift on this terminal was resumed. This is the same shift, not a new one."
              : "Your shift is open on this terminal."}
          </p>

          {opening.recordedMinor != null && (
            <p className="flex items-center justify-between rounded-amb bg-amb-sunken px-3 py-2 text-sm">
              <span className="text-amb-ink-secondary">Opening cash</span>
              <span className="amb-tnum font-semibold text-amb-ink">{formatMinor(opening.recordedMinor)}</span>
            </p>
          )}

          {needsCash && (
            <div className="amb-fade-in space-y-2 rounded-amb border border-amb-caution/40 bg-amb-caution-soft p-3">
              <OpeningCashInput id="till-opening-cash-late" value={cashText} onChange={setCashTyped} hint={cashHint} />
              <Button
                tone="accent"
                className="amb-press w-full"
                disabled={cashMinor === null || opening.saving}
                onClick={() => cashMinor !== null && onRecordOpening(sessionId, cashMinor)}
              >
                {opening.saving ? "Saving…" : "Save opening cash"}
              </Button>
            </div>
          )}
          {opening.error && <p role="alert" className="text-sm text-amb-critical">{opening.error}</p>}

          <Link
            href={`/cash/${sessionId}`}
            className="amb-press flex min-h-touch w-full items-center justify-center rounded-amb border border-amb-line-strong bg-amb-raised px-4 text-sm font-semibold text-amb-ink transition-colors hover:bg-amb-sunken"
          >
            Count cash &amp; close day
          </Link>

          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold text-amb-ink-secondary hover:text-amb-ink min-h-11 flex items-center">Quick close without counting</summary>
            <div className="mt-3 space-y-3">
              <Field label="Closing note" hint="Handover note only. Count the drawer later in Cash & Day Close.">
                <input
                  className={inputClass}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={500}
                  placeholder="Anything the next cashier should know"
                />
              </Field>
              <Button tone="critical" onClick={() => onClose(note)}>
                Close shift
              </Button>
            </div>
          </details>
        </div>
      </Panel>
    );
  }

  const terminalDone = selectedDevice !== null;

  return (
    <Panel title="Start your shift" className="p-4">
      <div className="space-y-4 p-1">
        {session.phase === "conflict" && <ErrorBanner error={session.error} onDismiss={onDismiss} />}
        {session.phase === "unavailable" && <ErrorBanner error={session.error} onDismiss={onDismiss} />}
        {session.phase === "closed" && (
          <div
            role="status"
            className="rounded-amb border border-amb-line bg-amb-sunken px-4 py-3 text-sm text-amb-ink-secondary"
          >
            This shift is closed. Open a new one to carry on selling.
          </div>
        )}

        <ol>
          <Step n={1} title="Terminal" done={terminalDone} current={!terminalDone}>
            {devices.phase === "loading" && (
              <div className="space-y-2">
                <p className="text-sm text-amb-ink-muted" role="status">
                  Looking for terminals…
                </p>
                <SetUpTerminalLink />
              </div>
            )}
            {devices.phase === "error" && (
              <div className="space-y-2">
                {devices.error && <ErrorBanner error={devices.error} />}
                <SetUpTerminalLink />
              </div>
            )}
            {devices.phase === "ready" && (
              <DevicePicker devices={devices.devices} selectedId={selectedDevice?.id ?? null} onSelect={onSelectDevice} />
            )}
          </Step>

          <Step n={2} title="Opening cash" done={false} current={terminalDone && canStart}>
            <OpeningCashInput id="till-opening-cash" value={cashText} onChange={setCashTyped} hint={cashHint} />
          </Step>

          <Step n={3} title="Start selling" done={false} current={terminalDone && canStart}>
            <Button
              tone="accent"
              size="lg"
              onClick={() => onOpen(cashMinor)}
              disabled={!selectedDevice || (cashText.trim() !== "" && cashMinor === null)}
              className="amb-press w-full"
            >
              {selectedDevice ? `Open shift on ${selectedDevice.code}` : "Choose a terminal first"}
            </Button>
          </Step>
        </ol>

        {(session.phase === "opening" || session.phase === "closing") && (
          <p role="status" aria-live="polite" className="text-sm font-medium text-amb-ink">
            {session.phase === "opening" ? "Opening your shift…" : "Closing your shift…"}
          </p>
        )}
      </div>
    </Panel>
  );
}
