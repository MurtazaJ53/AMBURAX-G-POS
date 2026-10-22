import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, IDS, resetDatabase, seedTwoTenants } from "./db";
import { pairPosDeviceHere } from "@/server/pos/posDeviceLifecycle";

/** One-click till setup: an owner or store manager signed in at the counter activates the terminal. */

const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const, membershipRole: "OWNER", storeId: IDS.storeA };
const cashier = { tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF" as const, membershipRole: "CASHIER", storeId: IDS.storeA };

async function terminal(extra: { activatedAt?: Date; disabledAt?: Date } = {}) {
  return db.posDevice.create({
    data: {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      name: "Main Counter",
      code: `T${Math.floor(Math.random() * 1e6)}`,
      createdByUserId: IDS.ownerA,
      pairingCodeHash: `hash-${Math.random()}`,
      pairingExpiresAt: new Date(Date.now() + 60_000),
      ...extra,
    },
    select: { id: true },
  });
}

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});

afterAll(async () => {
  await resetDatabase();
});

describe("pairing a terminal in person", () => {
  it("an owner activates it in one step, the old code is voided, and it is recorded", async () => {
    const t = await terminal();
    const res = await pairPosDeviceHere({ actor: owner, posDeviceId: t.id });
    expect(res.status).toBe("ok");
    const after = await db.posDevice.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.activatedAt).not.toBeNull();
    expect(after.pairingCodeHash).toBeNull();
    expect(after.deviceSecretHash).not.toBeNull();
    expect(await db.outboxEvent.count({ where: { entityId: t.id, eventType: "PosDeviceActivated" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "PosDevicePairedInPerson" } })).toBe(1);
    // Twice is refused, not repeated.
    expect((await pairPosDeviceHere({ actor: owner, posDeviceId: t.id })).status).toBe("already_activated");
  });

  it("a cashier, another tenant or a disabled terminal can't", async () => {
    const t = await terminal();
    expect((await pairPosDeviceHere({ actor: cashier, posDeviceId: t.id })).status).toBe("forbidden");
    const other = { ...owner, tenantId: IDS.tenantB, userId: IDS.ownerB, storeId: IDS.storeB };
    expect((await pairPosDeviceHere({ actor: other, posDeviceId: t.id })).status).toBe("not_found");
    const off = await terminal({ disabledAt: new Date() });
    expect((await pairPosDeviceHere({ actor: owner, posDeviceId: off.id })).status).toBe("disabled");
    expect((await db.posDevice.findUniqueOrThrow({ where: { id: t.id } })).activatedAt).toBeNull();
  });
});
