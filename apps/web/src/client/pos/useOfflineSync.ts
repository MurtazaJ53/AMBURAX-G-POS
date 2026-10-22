import { useState, useEffect, useCallback } from "react";
import { offlineStore, type QueuedSale } from "@/client/pos/offlineStore";
import * as api from "@/client/pos/posApi";

export type NetworkMode = "ONLINE" | "OFFLINE" | "SYNCING";

export interface OfflineStatus {
  mode: NetworkMode;
  isOnline: boolean;
  queuedCount: number;
  catalogSyncedAt: string | null;
  catalogItemCount: number;
  syncCatalog: () => Promise<number>;
  replayQueue: () => Promise<{ success: number; failed: number }>;
}

export function useOfflineSync(): OfflineStatus {
  // Start "online" on server and browser alike so the first render matches: Node defines
  // `navigator` without `onLine`, which rendered "Offline Mode" on the server and broke hydration.
  // The real network state is read after mount (below).
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [mode, setMode] = useState<NetworkMode>("ONLINE");
  const [queuedCount, setQueuedCount] = useState<number>(0);
  const [catalogSyncedAt, setCatalogSyncedAt] = useState<string | null>(null);
  const [catalogItemCount, setCatalogItemCount] = useState<number>(0);

  // Refresh queue count
  const refreshQueueCount = useCallback(async () => {
    try {
      const queued = await offlineStore.getQueuedSales();
      setQueuedCount(queued.length);
    } catch {
      // IndexedDB not ready
    }
  }, []);

  // Sync catalog from server to local storage
  const syncCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/pos/offline-catalog");
      const data = await res.json();
      if (res.ok && data.status === "ok" && Array.isArray(data.items)) {
        await offlineStore.syncCatalog(data.items);
        setCatalogSyncedAt(data.syncedAt);
        setCatalogItemCount(data.count);
        return data.count;
      }
      return 0;
    } catch {
      return 0;
    }
  }, []);

  // Replay queued sales
  const replayQueue = useCallback(async () => {
    const queued = await offlineStore.getQueuedSales();
    if (queued.length === 0) return { success: 0, failed: 0 };

    setMode("SYNCING");
    let success = 0;
    let failed = 0;

    for (const item of queued) {
      try {
        const res = await api.createSale(item.request);
        if (res.ok) {
          await offlineStore.removeQueuedSale(item.idempotencyKey);
          success++;
        } else {
          const errMsg = res.kind === "api" ? res.message : res.kind;
          await offlineStore.markQueueFailure(item.idempotencyKey, errMsg || "Server refused");
          failed++;
        }
      } catch (err) {
        await offlineStore.markQueueFailure(
          item.idempotencyKey,
          err instanceof Error ? err.message : "Network error"
        );
        failed++;
      }
    }

    await refreshQueueCount();
    setMode(navigator.onLine ? "ONLINE" : "OFFLINE");
    return { success, failed };
  }, [refreshQueueCount]);

  // Listen to browser network changes
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setMode("ONLINE");
      void replayQueue();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setMode("OFFLINE");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    if (!navigator.onLine) handleOffline();

    // Initial load
    let active = true;
    void (async () => {
      await refreshQueueCount();
      if (active) {
        await syncCatalog();
      }
    })();

    return () => {
      active = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshQueueCount, replayQueue, syncCatalog]);

  return {
    mode,
    isOnline,
    queuedCount,
    catalogSyncedAt,
    catalogItemCount,
    syncCatalog,
    replayQueue,
  };
}
