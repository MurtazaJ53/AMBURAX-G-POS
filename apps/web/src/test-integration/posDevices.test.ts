import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import { listPosDevices } from "@/server/pos/posDeviceQueries";

/**
 * Reading a store's terminals, against real PostgreSQL.
 *
 * This endpoint was added so a browser can name the till it is standing at — the id otherwise
 * appears only in an activation response handed to the machine being paired. It is a read, and
 * the two things worth proving about a read are the two proven here: it cannot reach another
 * tenant's terminals, and it never returns a credential.
 */

async function makeDevice(params: {
  tenantId: string;
  storeId: string;
  userId: string;
  code: string;
  activated?: boolean;
  disabled?: boolean;
}) {
  const device = await db.posDevice.create({
    data: {
      tenantId: params.tenantId,
      storeId: params.storeId,
      name: `Till ${params.code}`,
      code: params.code,
      createdByUserId: params.userId,
      activatedAt: params.activated === false ? null : new Date(),
      disabledAt: params.disabled ? new Date() : null,
      pairingCodeHash: params.activated === false ? `hash-${params.tenantId}-${params.code}` : null,
      pairingExpiresAt:
        params.activated === false ? new Date(Date.now() + 60 * 60 * 1000) : null,
      deviceSecretHash: params.activated === false ? null : `secret-${params.tenantId}-${params.code}`,
    },
    select: { id: true },
  });
  return device.id;
}

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("listing a store's terminals", () => {
  it("returns the store's own terminals with a derived status", async () => {
    await makeDevice({ tenantId: IDS.tenantA, storeId: IDS.storeA, userId: IDS.ownerA, code: "T1" });
    await makeDevice({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      userId: IDS.ownerA,
      code: "T2",
      activated: false,
    });
    await makeDevice({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      userId: IDS.ownerA,
      code: "T3",
      disabled: true,
    });

    const result = await listPosDevices({ tenantId: IDS.tenantA, storeId: IDS.storeA });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.devices.map((device) => [device.code, device.status])).toEqual([
      ["T1", "ACTIVE"],
      ["T2", "PENDING_ACTIVATION"],
      ["T3", "DISABLED"],
    ]);
  });

  it("cannot reach another tenant's terminals, even given their store id", async () => {
    await makeDevice({ tenantId: IDS.tenantB, storeId: IDS.storeB, userId: IDS.ownerB, code: "T1" });

    // Scoped on tenant as well as store, so a store id guessed from another tenant yields an
    // empty list rather than that tenant's terminals.
    const result = await listPosDevices({ tenantId: IDS.tenantA, storeId: IDS.storeB });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.devices).toEqual([]);
  });

  it("never returns a pairing code or a device secret", async () => {
    await makeDevice({ tenantId: IDS.tenantA, storeId: IDS.storeA, userId: IDS.ownerA, code: "T1" });

    const result = await listPosDevices({ tenantId: IDS.tenantA, storeId: IDS.storeA });
    if (result.status !== "ok") throw new Error("expected ok");

    const serialized = JSON.stringify(result.devices);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("hash");
    for (const device of result.devices) {
      expect(device).not.toHaveProperty("deviceSecretHash");
      expect(device).not.toHaveProperty("pairingCodeHash");
      expect(device).not.toHaveProperty("pairingExpiresAt");
    }
  });

  it("refuses when RETAIL is switched off, rather than returning an empty list", async () => {
    await makeDevice({ tenantId: IDS.tenantA, storeId: IDS.storeA, userId: IDS.ownerA, code: "T1" });
    await db.tenantCapability.updateMany({
      where: { tenantId: IDS.tenantA, capability: "RETAIL" },
      data: { enabled: false },
    });

    // An empty list and a disabled module are different facts. The route flattens the refusal
    // to a plain not-found at the boundary; in process it stays distinguishable.
    const result = await listPosDevices({ tenantId: IDS.tenantA, storeId: IDS.storeA });
    expect(result.status).toBe("capability_disabled");
  });
});
