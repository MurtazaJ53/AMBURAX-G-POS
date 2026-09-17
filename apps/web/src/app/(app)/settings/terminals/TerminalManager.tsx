"use client";

import { useState, useEffect, useRef } from "react";
import { type PosDeviceView } from "@/server/pos/posDeviceQueries";
import { type PosDeviceStatus } from "@/server/pos/posDevice";
import { apiRequest } from "@/client/platform/apiClient";
import {
  Card,
  DataTable,
  Th,
  Td,
  StatusBadge,
  buttonClass,
  EmptyState,
  ErrorState,
  LoadingState,
} from "../../_components/ui";

function formatStatus(status: PosDeviceStatus) {
  switch (status) {
    case "PENDING_ACTIVATION":
      return <StatusBadge tone="warning">Pending Activation</StatusBadge>;
    case "PAIRING_EXPIRED":
      return <StatusBadge tone="neutral">Pairing Expired</StatusBadge>;
    case "ACTIVE":
      return <StatusBadge tone="success">Active</StatusBadge>;
    case "DISABLED":
      return <StatusBadge tone="danger">Disabled</StatusBadge>;
  }
}

export function TerminalManager() {
  const [devices, setDevices] = useState<PosDeviceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [mutatingId, setMutatingId] = useState<string | null>(null);
  
  // Dialog state
  const [disableTarget, setDisableTarget] = useState<PosDeviceView | null>(null);
  const [repairTarget, setRepairTarget] = useState<PosDeviceView | null>(null);
  const [repairSuccess, setRepairSuccess] = useState<{ code: string; device: string } | null>(null);

  const disableDialogRef = useRef<HTMLDialogElement>(null);
  const repairDialogRef = useRef<HTMLDialogElement>(null);
  const successDialogRef = useRef<HTMLDialogElement>(null);

  const loadDevices = async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    const res = await apiRequest<{ devices: PosDeviceView[] }>("/api/v1/pos/devices");
    if (res.ok) {
      setDevices(res.data.devices);
    } else if (res.kind === "api" && res.status === 403) {
      setForbidden(true);
    } else {
      setError("Failed to load terminals.");
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDevices();
  }, []);

  useEffect(() => {
    if (disableTarget) disableDialogRef.current?.showModal();
    else disableDialogRef.current?.close();
  }, [disableTarget]);

  useEffect(() => {
    if (repairTarget) repairDialogRef.current?.showModal();
    else repairDialogRef.current?.close();
  }, [repairTarget]);

  useEffect(() => {
    if (repairSuccess) successDialogRef.current?.showModal();
    else successDialogRef.current?.close();
  }, [repairSuccess]);

  const handleDisable = async () => {
    if (!disableTarget) return;
    setMutatingId(disableTarget.id);
    const res = await apiRequest(`/api/v1/pos/devices/${disableTarget.id}/disable`, { method: "POST" });
    setMutatingId(null);
    setDisableTarget(null);
    if (res.ok) {
      await loadDevices();
    } else {
      alert(`Disable failed: ${res.kind === "api" ? res.message : "Network error"}`);
    }
  };

  const handleRepair = async () => {
    if (!repairTarget) return;
    setMutatingId(repairTarget.id);
    const res = await apiRequest<{ pairingCode: string }>(`/api/v1/pos/devices/${repairTarget.id}/re-pair`, { method: "POST" });
    setMutatingId(null);
    setRepairTarget(null);
    
    if (res.ok) {
      setRepairSuccess({ code: res.data.pairingCode, device: repairTarget.name });
      await loadDevices();
    } else {
      alert(`Re-pair failed: ${res.kind === "api" ? res.message : "Network error"}`);
    }
  };

  if (loading) return <LoadingState label="Loading terminals..." />;
  if (forbidden) return <ErrorState title="Access Denied" description="You don't have permission to view POS terminals." />;
  if (error) return <ErrorState title="Error" description={error} action={<button onClick={loadDevices} className={buttonClass("secondary")}>Retry</button>} />;
  if (devices.length === 0) return <EmptyState title="No Terminals" description="There are no POS terminals registered to this store." />;

  return (
    <div>
      <Card>
        <DataTable>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Code</Th>
              <Th>Status</Th>
              <Th>Last Seen</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <Td className="font-medium text-slate-900">{device.name}</Td>
                <Td className="text-slate-500">{device.code}</Td>
                <Td>{formatStatus(device.status)}</Td>
                <Td className="text-slate-500">{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Never"}</Td>
                <Td align="right">
                  <div className="flex justify-end gap-2">
                    {device.status !== "DISABLED" && (
                      <button
                        type="button"
                        className={buttonClass("secondary")}
                        onClick={() => setDisableTarget(device)}
                        disabled={mutatingId === device.id}
                        aria-label={`Disable ${device.name}`}
                      >
                        {mutatingId === device.id ? "Disabling..." : "Disable"}
                      </button>
                    )}
                    {device.status === "DISABLED" && (
                      <button
                        type="button"
                        className={buttonClass("primary")}
                        onClick={() => setRepairTarget(device)}
                        disabled={mutatingId === device.id}
                        aria-label={`Re-pair ${device.name}`}
                      >
                        {mutatingId === device.id ? "Working..." : "Re-pair"}
                      </button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>

      <dialog ref={disableDialogRef} className="rounded-xl border border-slate-200 p-6 shadow-xl backdrop:bg-slate-900/50 open:animate-in open:fade-in open:zoom-in-95" onClose={() => setDisableTarget(null)}>
        <h2 className="text-lg font-semibold text-slate-900">Disable Terminal</h2>
        <p className="mt-2 max-w-sm text-sm text-slate-600">
          Are you sure you want to disable <strong>{disableTarget?.name}</strong>? 
          This will prevent the terminal from starting or continuing sales.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className={buttonClass("ghost")} onClick={() => setDisableTarget(null)} disabled={mutatingId !== null}>Cancel</button>
          <button type="button" className={buttonClass("primary")} onClick={handleDisable} disabled={mutatingId !== null}>
            {mutatingId !== null ? "Disabling..." : "Confirm Disable"}
          </button>
        </div>
      </dialog>

      <dialog ref={repairDialogRef} className="rounded-xl border border-slate-200 p-6 shadow-xl backdrop:bg-slate-900/50 open:animate-in open:fade-in open:zoom-in-95" onClose={() => setRepairTarget(null)}>
        <h2 className="text-lg font-semibold text-slate-900">Re-pair Terminal</h2>
        <p className="mt-2 max-w-sm text-sm text-slate-600">
          Are you sure you want to re-pair <strong>{repairTarget?.name}</strong>? 
          The existing terminal credential will be invalidated and physical pairing will be required again.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className={buttonClass("secondary")} onClick={() => setRepairTarget(null)} disabled={mutatingId !== null}>Cancel</button>
          <button type="button" className={buttonClass("primary")} onClick={handleRepair} disabled={mutatingId !== null}>
            {mutatingId !== null ? "Working..." : "Confirm Re-pair"}
          </button>
        </div>
      </dialog>

      <dialog ref={successDialogRef} className="rounded-xl border border-slate-200 p-6 shadow-xl backdrop:bg-slate-900/50 open:animate-in open:fade-in open:zoom-in-95" onClose={() => setRepairSuccess(null)}>
        <h2 className="text-lg font-semibold text-slate-900">Terminal Ready to Pair</h2>
        <p className="mt-2 max-w-sm text-sm text-slate-600">
          The terminal <strong>{repairSuccess?.device}</strong> has been successfully prepared for pairing. 
          Enter this code on the device to activate it:
        </p>
        <div className="mt-4 rounded-lg bg-slate-50 p-4 text-center">
          <span className="text-2xl font-mono font-bold tracking-widest text-slate-900">{repairSuccess?.code}</span>
        </div>
        <div className="mt-6 flex justify-end">
          <button type="button" className={buttonClass("primary")} onClick={() => setRepairSuccess(null)}>Done</button>
        </div>
      </dialog>
    </div>
  );
}
