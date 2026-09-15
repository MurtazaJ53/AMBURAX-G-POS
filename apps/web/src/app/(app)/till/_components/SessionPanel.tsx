"use client";

import { useState } from "react";
import type { SessionState } from "@/client/pos/session";
import type { PosDevice } from "@/client/pos/types";
import type { DeviceState } from "./useTill";
import { Button, Chip, Field, inputClass, Panel } from "./primitives";
import { ErrorBanner } from "./ErrorBanner";

/**
 * Opening, resuming and ending a shift.
 *
 * Covers every state the backend can be in, because the ones that are easy to skip are the
 * ones that hurt: a shift belonging to another cashier, a terminal that was never paired, a
 * close that was refused. Each gets its own words and its own next action rather than a shared
 * "something went wrong".
 *
 * ## No cash
 *
 * There is no opening float, no counted drawer and no variance field, and that is a deliberate
 * match to the backend rather than an omission. `closingNote` is free text about a handover;
 * a money input here would produce a figure nobody reconciles, which is worse than no figure.
 *
 * ## Resume
 *
 * A reloaded browser is the same shift, not a second one, and the panel says "resumed" rather
 * than implying a new shift began.
 */

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
      <p className="text-sm text-amb-ink-secondary">
        This store has no terminals set up. An owner or store manager can add one in POS setup.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-amb-ink-muted">
          Terminal
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {usable.map((device) => (
            <button
              key={device.id}
              type="button"
              onClick={() => onSelect(device.id)}
              aria-pressed={device.id === selectedId}
              className={`min-h-touch rounded-amb border px-4 py-3 text-left transition-colors ${
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

      {unusable.length > 0 && (
        <div className="rounded-amb border border-amb-line bg-amb-sunken px-3 py-2">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-amb-ink-muted">
            Not usable
          </p>
          <ul className="space-y-1">
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
        </div>
      )}
    </div>
  );
}

export function SessionPanel({
  devices,
  selectedDevice,
  onSelectDevice,
  session,
  onOpen,
  onClose,
  onDismiss,
}: {
  devices: DeviceState;
  selectedDevice: PosDevice | null;
  onSelectDevice: (id: string) => void;
  session: SessionState;
  onOpen: () => void;
  onClose: (note: string) => void;
  onDismiss: () => void;
}) {
  const [note, setNote] = useState("");

  return (
    <Panel title="Shift" className="p-4">
      <div className="space-y-4 p-1">
        {devices.phase === "loading" && (
          <p className="text-sm text-amb-ink-muted" role="status">
            Looking for terminals…
          </p>
        )}

        {devices.phase === "error" && devices.error && <ErrorBanner error={devices.error} />}

        {devices.phase === "ready" && (
          <DevicePicker
            devices={devices.devices}
            selectedId={selectedDevice?.id ?? null}
            onSelect={onSelectDevice}
          />
        )}

        {session.phase === "conflict" && (
          <ErrorBanner error={session.error} onDismiss={onDismiss} />
        )}
        {session.phase === "unavailable" && (
          <ErrorBanner error={session.error} onDismiss={onDismiss} />
        )}

        {session.phase === "closed" && (
          <div
            role="status"
            className="rounded-amb border border-amb-line bg-amb-sunken px-4 py-3 text-sm text-amb-ink-secondary"
          >
            This shift is closed. Open a new one to carry on selling.
          </div>
        )}

        {session.phase === "active" && (
          <div className="space-y-3">
            <p className="text-sm text-amb-ink-secondary">
              {session.resumed
                ? "Your shift on this terminal was resumed. This is the same shift, not a new one."
                : "Your shift is open on this terminal."}
            </p>
            <Field
              label="Closing note"
              hint="Free text for the handover. This is not a cash count — AMBURAX does not balance drawers yet."
            >
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
        )}

        {(session.phase === "no_session" ||
          session.phase === "closed" ||
          session.phase === "unknown") && (
          <Button
            tone="accent"
            size="lg"
            onClick={onOpen}
            disabled={!selectedDevice}
            className="w-full"
          >
            {selectedDevice ? `Open shift on ${selectedDevice.code}` : "Choose a terminal first"}
          </Button>
        )}

        {(session.phase === "opening" || session.phase === "closing") && (
          <p role="status" aria-live="polite" className="text-sm font-medium text-amb-ink">
            {session.phase === "opening" ? "Opening your shift…" : "Closing your shift…"}
          </p>
        )}
      </div>
    </Panel>
  );
}
