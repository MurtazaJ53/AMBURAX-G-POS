"use client";

import { useEffect, useState } from "react";
import { Wifi, WifiOff, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { getUnsyncedSales, syncOfflineQueue, type OfflineSalePayload } from "./offlineDb";

export function OfflineIndicatorPill() {
  // Start "online" on both server and browser so the first render matches (Node defines
  // `navigator` without `onLine`, which rendered "offline" on the server and broke hydration on
  // every page). The real value is read after mount.
  const [isOnline, setIsOnline] = useState<boolean>(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsOnline(navigator.onLine);
  }, []);
  const [pendingQueue, setPendingQueue] = useState<OfflineSalePayload[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [showModal, setShowModal] = useState<boolean>(false);

  // Monitor network connectivity
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => {
      setIsOnline(true);
      triggerAutoSync();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial queue check
    loadQueue();

    // Check periodically
    const interval = setInterval(() => {
      void getUnsyncedSales().then(setPendingQueue);
    }, 15000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, []);

  async function loadQueue() {
    const items = await getUnsyncedSales();
    setPendingQueue(items);
  }

  async function triggerAutoSync() {
    setIsSyncing(true);
    try {
      await syncOfflineQueue();
      await loadQueue();
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Offline / Online Connectivity Pill */}
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm transition-all cursor-pointer ${
            !isOnline
              ? "bg-amber-100 text-amber-900 border border-amber-300 ring-2 ring-amber-400/20 animate-pulse"
              : pendingQueue.length > 0
                ? "bg-sky-100 text-sky-900 border border-sky-300 ring-2 ring-sky-400/20"
                : "bg-emerald-50 text-emerald-800 border border-emerald-200"
          }`}
          title={
            !isOnline
              ? "Operating in Offline Mode. Sales saved locally."
              : pendingQueue.length > 0
                ? `${pendingQueue.length} sales pending sync`
                : "Terminal Online & Synced"
          }
        >
          {!isOnline ? (
            <>
              <WifiOff className="h-3.5 w-3.5 text-amber-700" />
              <span>Offline Mode</span>
            </>
          ) : pendingQueue.length > 0 ? (
            <>
              <RefreshCw className={`h-3.5 w-3.5 text-sky-700 ${isSyncing ? "animate-spin" : ""}`} />
              <span>{pendingQueue.length} Pending Sync</span>
            </>
          ) : (
            <>
              <Wifi className="h-3.5 w-3.5 text-emerald-600" />
              <span className="hidden sm:inline">Online</span>
            </>
          )}
        </button>
      </div>

      {/* Offline Queue Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-800">
                  {!isOnline ? <WifiOff className="h-4 w-4 text-amber-600" /> : <Wifi className="h-4 w-4 text-emerald-600" />}
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Network & Offline Queue</h3>
                  <p className="text-[11px] text-slate-500">IndexedDB local cashier storage</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs">
                <span className="font-medium text-slate-600">Connection Status:</span>
                <span className={`font-bold ${isOnline ? "text-emerald-700" : "text-amber-700"}`}>
                  {isOnline ? "Active Internet (Online)" : "Disconnected (Offline Mode Active)"}
                </span>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs">
                <span className="font-medium text-slate-600">Queued Offline Bills:</span>
                <span className="font-mono font-bold text-slate-900">{pendingQueue.length} orders</span>
              </div>

              {pendingQueue.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-2 pt-2">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Pending Offline Invoices</p>
                  {pendingQueue.map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-200 p-2.5 text-xs bg-slate-50/50">
                      <div className="flex justify-between font-semibold text-slate-900">
                        <span>{item.customerName || "Walk-in Customer"}</span>
                        <span>₹{(item.totalMinor / 100).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-slate-500 mt-1">
                        <span>Method: {item.paymentMethod}</span>
                        <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={!isOnline || isSyncing || pendingQueue.length === 0}
                onClick={triggerAutoSync}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-primary-hover disabled:opacity-40 cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Syncing with Server..." : "Sync Offline Queue Now"}
              </button>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
