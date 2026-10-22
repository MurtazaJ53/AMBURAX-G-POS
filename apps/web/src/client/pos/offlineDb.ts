/**
 * IndexedDB Offline POS Queue for Cashier Transactions
 *
 * Ensures cashiering continuity during network dropouts by safely queuing completed
 * offline cash/UPI payments locally, synchronizing with the server once online.
 */

export interface OfflineSalePayload {
  id: string; // client temporary ID
  idempotencyKey: string;
  storeCode: string;
  lines: {
    variantId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPriceMinor: number;
  }[];
  totalMinor: number;
  paymentMethod: string;
  amountReceivedMinor: number;
  customerId?: string | null;
  customerName?: string | null;
  timestamp: number;
  synced: boolean;
  syncError?: string | null;
}

const DB_NAME = "amburax_pos_offline_db";
const STORE_NAME = "queued_sales";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB not available in this environment"));
      return;
    }

    const req = window.indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("synced", "synced", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Queue an offline sale into IndexedDB
 */
export async function queueOfflineSale(sale: Omit<OfflineSalePayload, "id" | "synced" | "timestamp">): Promise<OfflineSalePayload> {
  const db = await openDb();
  const record: OfflineSalePayload = {
    ...sale,
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    synced: false,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(record);

    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all unsynced sales from local IndexedDB
 */
export async function getUnsyncedSales(): Promise<OfflineSalePayload[]> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const all: OfflineSalePayload[] = req.result || [];
        resolve(all.filter((s) => !s.synced));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/**
 * Mark an offline sale as successfully synced or delete it
 */
export async function markSaleSynced(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Replay unsynced sales back to the POS sales API
 */
export async function syncOfflineQueue(
  onSuccess?: (saleId: string) => void,
  onError?: (saleId: string, error: string) => void
): Promise<{ syncedCount: number; failedCount: number }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { syncedCount: 0, failedCount: 0 };
  }

  const pending = await getUnsyncedSales();
  let syncedCount = 0;
  let failedCount = 0;

  for (const sale of pending) {
    try {
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: sale.idempotencyKey,
          lines: sale.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
          customerId: sale.customerId || undefined,
          payments: [
            {
              method: sale.paymentMethod,
              amountMinor: sale.amountReceivedMinor,
            },
          ],
        }),
      });

      if (res.ok) {
        await markSaleSynced(sale.id);
        syncedCount++;
        onSuccess?.(sale.id);
      } else {
        const data = await res.json().catch(() => ({}));
        failedCount++;
        onError?.(sale.id, data.message || "Failed to sync transaction");
      }
    } catch (err: unknown) {
      failedCount++;
      const msg = err instanceof Error ? err.message : "Network error during sync";
      onError?.(sale.id, msg);
    }
  }

  return { syncedCount, failedCount };
}
