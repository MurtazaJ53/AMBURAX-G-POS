import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import { openPosSession, type PosSessionActor } from "@/server/pos/posSessionService";
import { closeAndCount, openingFloatOf, setOpeningFloat, suggestedOpeningFloat } from "@/server/pos/cashRegister";

/** The till's start-of-shift step: opening cash is suggested from the cash counted at the last close. */

const owner: PosSessionActor = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER", membershipRole: "OWNER" };

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});

afterAll(async () => {
  await resetDatabase();
});

async function terminal() {
  return db.posDevice.create({
    data: {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      name: "Till 1",
      code: "T1",
      createdByUserId: IDS.ownerA,
      pairingCodeHash: "x",
      pairingExpiresAt: new Date(Date.now() + 100_000),
      activatedAt: new Date(),
    },
    select: { id: true },
  });
}

async function open(posDeviceId: string) {
  const res = await openPosSession({ actor: owner, posDeviceId, correlationId: "c" });
  if (res.status !== "ok") throw new Error(`open failed: ${res.status}`);
  return res.session.id;
}

describe("opening cash suggestion", () => {
  it("is empty before any counted close, then the cash counted at the last close", async () => {
    const t = await terminal();
    expect(await suggestedOpeningFloat({ tenantId: IDS.tenantA, posDeviceId: t.id })).toEqual({ suggestedMinor: null, fromClosedAt: null });

    const first = await open(t.id);
    await setOpeningFloat({ actor: owner, sessionId: first, amountMinor: 100_000 });
    expect(await openingFloatOf({ tenantId: IDS.tenantA, sessionId: first })).toBe(100_000);
    const closed = await closeAndCount({ actor: owner, sessionId: first, counted: { CASH: 100_000, UPI: 0, CARD: 0 } });
    expect(closed.status).toBe("ok");

    const next = await suggestedOpeningFloat({ tenantId: IDS.tenantA, posDeviceId: t.id });
    expect(next.suggestedMinor).toBe(100_000);
    expect(next.fromClosedAt).not.toBeNull();

    // A new shift has no float until the cashier confirms one, and another tenant sees nothing.
    const second = await open(t.id);
    expect(await openingFloatOf({ tenantId: IDS.tenantA, sessionId: second })).toBeNull();
    expect(await openingFloatOf({ tenantId: IDS.tenantB, sessionId: first })).toBeNull();
    expect((await suggestedOpeningFloat({ tenantId: IDS.tenantB, posDeviceId: t.id })).suggestedMinor).toBeNull();
  });
});
