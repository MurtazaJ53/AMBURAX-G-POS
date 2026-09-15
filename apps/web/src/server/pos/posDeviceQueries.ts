import { db } from "@/server/db";
import { Capability } from "@/server/capability/capabilities";
import { requireCapability } from "@/server/capability/capabilityService";
import { derivePosDeviceStatus, type PosDeviceStatus } from "@/server/pos/posDevice";

/**
 * Reading the terminals a store has.
 *
 * Added for the till surface, which has a problem the device-facing endpoints do not solve:
 * `POST /pos/sessions` needs a `posDeviceId`, and the only other place that id appears is the
 * activation response, which is handed to the machine being paired rather than to a browser.
 * A cashier signing in on a paired terminal therefore had no way to name the terminal they are
 * standing at. This closes that, and nothing more.
 *
 * Read-only by construction. Nothing here creates, pairs, disables or reconfigures a terminal;
 * those paths already exist and are unchanged.
 *
 * What is deliberately absent from the returned view: `pairingCodeHash`, `deviceSecretHash`,
 * `pairingExpiresAt`. The first two are credentials and are never read at all — they appear in
 * no `select` here, so there is no path by which they could reach a response. The third is read,
 * because `derivePosDeviceStatus` needs it to tell a pairing window that has closed from one
 * that has not, and is then dropped: a timestamp that is only meaningful during setup tells an
 * operator nothing the derived status does not already say.
 */

export interface PosDeviceView {
  id: string;
  name: string;
  /** The terminal name on the floor — POS-01. Unique per store, not per tenant. */
  code: string;
  storeId: string;
  /** Derived from the lifecycle columns; there is no status column to disagree with it. */
  status: PosDeviceStatus;
  /** The shift currently open on this till, if any. A pointer, not a count. */
  activeSessionId: string | null;
  lastSeenAt: Date | null;
  scanSoundEnabled: boolean;
  showProductImages: boolean;
}

export type ListPosDevicesResult =
  | { status: "ok"; devices: PosDeviceView[] }
  | { status: "capability_disabled"; capability: Capability };

/**
 * The terminals in one store.
 *
 * Both `tenantId` and `storeId` come from the caller's resolved POS context, never from a
 * query string — the same posture as every other read on this surface. Scoping on tenant as
 * well as store is not redundant: it means a store id guessed from another tenant returns an
 * empty list rather than that tenant's terminals.
 *
 * Gated on RETAIL here, at the domain boundary, so a direct HTTP call is refused exactly as a
 * click would be. The route flattens the refusal to a plain not-found.
 */
export async function listPosDevices(params: {
  tenantId: string;
  storeId: string;
}): Promise<ListPosDevicesResult> {
  const gate = await requireCapability(params.tenantId, Capability.RETAIL);
  if (gate.status !== "ok") {
    return { status: "capability_disabled", capability: gate.capability };
  }

  const rows = await db.posDevice.findMany({
    where: { tenantId: params.tenantId, storeId: params.storeId },
    select: {
      id: true,
      name: true,
      code: true,
      storeId: true,
      activatedAt: true,
      disabledAt: true,
      pairingExpiresAt: true,
      activeSessionId: true,
      lastSeenAt: true,
      scanSoundEnabled: true,
      showProductImages: true,
    },
    orderBy: [{ code: "asc" }],
  });

  return {
    status: "ok",
    devices: rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      storeId: row.storeId,
      status: derivePosDeviceStatus(row),
      activeSessionId: row.activeSessionId,
      lastSeenAt: row.lastSeenAt,
      scanSoundEnabled: row.scanSoundEnabled,
      showProductImages: row.showProductImages,
    })),
  };
}
