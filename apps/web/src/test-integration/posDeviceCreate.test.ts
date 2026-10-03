import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import { createPosDevice } from "@/server/pos/posDeviceProvisioning";
import { listPosDevices } from "@/server/pos/posDeviceQueries";

/**
 * Adding a terminal after onboarding has finished, against real PostgreSQL.
 *
 * Until this operation existed, the only way to create a terminal was the onboarding step, which
 * claims the tenant's `onboardingStep` in the same transaction and refuses once that step has
 * passed. A business that completed setup without a till, or later bought a second one, had no
 * supported way to add it — the till screen asked for a terminal the product would not let them
 * create. These tests hold that door open, and hold shut the three that must stay shut: another
 * tenant's store, a capability that is switched off, and a second terminal wearing a taken code.
 */

const OWNER_A = {
  tenantId: IDS.tenantA,
  userId: IDS.ownerA,
  tenantRole: "OWNER" as const,
  membershipRole: "OWNER",
  storeId: IDS.storeA,
};

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});



describe("adding a terminal after onboarding", () => {
  it("creates a terminal, issues a pairing code, and stores only its hash", async () => {
    const result = await createPosDevice({
      actor: OWNER_A,
      name: "Counter 2",
      code: "pos-02",
      correlationId: "corr-create",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    // The code is normalised, so "pos-02" and "POS-02" cannot both exist as separate terminals.
    expect(result.device.code).toBe("POS-02");
    expect(result.device.status).toBe("PENDING_ACTIVATION");
    expect(result.pairingCode).toMatch(/[A-Z0-9]/);

    const row = await db.posDevice.findUniqueOrThrow({
      where: { id: result.device.id },
      select: {
        tenantId: true,
        storeId: true,
        pairingCodeHash: true,
        deviceSecretHash: true,
        activatedAt: true,
      },
    });
    expect(row.tenantId).toBe(IDS.tenantA);
    expect(row.storeId).toBe(IDS.storeA);
    expect(row.activatedAt).toBeNull();
    expect(row.deviceSecretHash).toBeNull();

    // The pairing code itself is never persisted — only something derived from it. If the plain
    // code were ever written to the row, this is where it would show.
    expect(row.pairingCodeHash).not.toBeNull();
    expect(row.pairingCodeHash).not.toContain(result.pairingCode.replace(/-/g, ""));
  });

  it("works when onboarding is already COMPLETE, and leaves the step alone", async () => {
    await db.tenant.update({
      where: { id: IDS.tenantA },
      data: { onboardingStep: "COMPLETE" },
    });

    // This is the gap itself. The onboarding path answers `already_completed` here; this one
    // must not, because finishing setup is not a reason to stop owning tills.
    const result = await createPosDevice({
      actor: OWNER_A,
      name: "Counter 2",
      code: "POS-02",
      correlationId: "corr-complete",
    });
    expect(result.status).toBe("ok");

    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: IDS.tenantA },
      select: { onboardingStep: true },
    });
    expect(tenant.onboardingStep).toBe("COMPLETE");
  });

  it("enqueues PosDeviceCreated in the same transaction, carrying no credential", async () => {
    const result = await createPosDevice({
      actor: OWNER_A,
      name: "Counter 2",
      code: "POS-02",
      correlationId: "corr-event",
    });
    if (result.status !== "ok") throw new Error("expected ok");

    const events = await db.outboxEvent.findMany({
      where: { tenantId: IDS.tenantA, eventType: "PosDeviceCreated" },
      select: { entityId: true, payload: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.entityId).toBe(result.device.id);

    // An outbox row is replayable and readable by every future consumer, so a live credential
    // in its payload would outlive the request that created it.
    const payload = JSON.stringify(events[0]!.payload);
    expect(payload).not.toContain(result.pairingCode);
    expect(payload).not.toContain(result.pairingCode.replace(/-/g, ""));
  });

  it("refuses a cashier, and records the refusal", async () => {
    const result = await createPosDevice({
      actor: { ...OWNER_A, userId: IDS.staffA, tenantRole: "STAFF", membershipRole: "CASHIER" },
      name: "Counter 2",
      code: "POS-02",
      correlationId: "corr-cashier",
    });
    expect(result.status).toBe("forbidden");

    expect(await db.posDevice.count({ where: { tenantId: IDS.tenantA } })).toBe(0);
    const audit = await db.auditLog.findFirst({
      where: { tenantId: IDS.tenantA, action: "PosDeviceSetupForbidden" },
    });
    expect(audit).not.toBeNull();
  });

  it("refuses when RETAIL is switched off", async () => {
    await db.tenantCapability.updateMany({
      where: { tenantId: IDS.tenantA, capability: "RETAIL" },
      data: { enabled: false },
    });

    const result = await createPosDevice({
      actor: OWNER_A,
      name: "Counter 2",
      code: "POS-02",
      correlationId: "corr-retail",
    });
    expect(result.status).toBe("capability_disabled");
    expect(await db.posDevice.count({ where: { tenantId: IDS.tenantA } })).toBe(0);
  });

  it("creates in the caller's own store, never one named by a caller", async () => {
    // There is no store parameter to misuse, so the test states the guarantee the shape gives:
    // an owner of tenant A, whatever they send, creates in store A and nowhere else.
    const result = await createPosDevice({
      actor: OWNER_A,
      name: "Counter 2",
      code: "POS-02",
      correlationId: "corr-store",
    });
    if (result.status !== "ok") throw new Error("expected ok");

    expect(result.device.storeId).toBe(IDS.storeA);
    expect(await db.posDevice.count({ where: { tenantId: IDS.tenantB } })).toBe(0);

    const seenByB = await listPosDevices({ tenantId: IDS.tenantB, storeId: IDS.storeB });
    if (seenByB.status !== "ok") throw new Error("expected ok");
    expect(seenByB.devices).toEqual([]);
  });

  it("lets two tenants use the same terminal code without colliding", async () => {
    const a = await createPosDevice({
      actor: OWNER_A,
      name: "Counter 1",
      code: "POS-01",
      correlationId: "corr-a",
    });
    const b = await createPosDevice({
      actor: {
        tenantId: IDS.tenantB,
        userId: IDS.ownerB,
        tenantRole: "OWNER",
        membershipRole: "OWNER",
        storeId: IDS.storeB,
      },
      name: "Counter 1",
      code: "POS-01",
      correlationId: "corr-b",
    });

    // Uniqueness is per store, not global. Two merchants both calling their first till POS-01
    // is the normal case, not a conflict.
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
  });

  it("rejects a duplicate code in the same store as a conflict, not a crash", async () => {
    const first = await createPosDevice({
      actor: OWNER_A,
      name: "Counter 1",
      code: "POS-01",
      correlationId: "corr-1",
    });
    expect(first.status).toBe("ok");

    const second = await createPosDevice({
      actor: OWNER_A,
      name: "Counter 1 again",
      code: "pos-01",
      correlationId: "corr-2",
    });
    expect(second.status).toBe("conflict");
    expect(await db.posDevice.count({ where: { storeId: IDS.storeA } })).toBe(1);
  });

  it("survives concurrent creation of the same code with exactly one winner", async () => {
    // `@@unique([storeId, code])` is what makes this safe: every request reaches the insert and
    // PostgreSQL decides. Without it, a double-submitted form would leave two tills sharing a
    // code and the till screen would have no way to tell them apart.
    const attempts = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        createPosDevice({
          actor: OWNER_A,
          name: `Counter ${n}`,
          code: "POS-09",
          correlationId: `corr-race-${n}`,
        }),
      ),
    );

    expect(attempts.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(attempts.filter((r) => r.status === "conflict")).toHaveLength(3);
    expect(await db.posDevice.count({ where: { storeId: IDS.storeA, code: "POS-09" } })).toBe(1);
  });

  it("rejects a name or code that could not name a terminal", async () => {
    const shortName = await createPosDevice({
      actor: OWNER_A,
      name: "X",
      code: "POS-02",
      correlationId: "corr-name",
    });
    expect(shortName.status).toBe("validation_error");

    const spacedCode = await createPosDevice({
      actor: OWNER_A,
      name: "Counter 2",
      code: "POS 02",
      correlationId: "corr-code",
    });
    expect(spacedCode.status).toBe("validation_error");

    expect(await db.posDevice.count({ where: { tenantId: IDS.tenantA } })).toBe(0);
  });

  it("produces a terminal the till can immediately see", async () => {
    const created = await createPosDevice({
      actor: OWNER_A,
      name: "Counter 2",
      code: "POS-02",
      correlationId: "corr-list",
    });
    if (created.status !== "ok") throw new Error("expected ok");

    // The point of the whole phase: a terminal added here is a terminal the till screen lists.
    const listed = await listPosDevices({ tenantId: IDS.tenantA, storeId: IDS.storeA });
    if (listed.status !== "ok") throw new Error("expected ok");
    expect(listed.devices.map((d) => [d.id, d.code, d.status])).toEqual([
      [created.device.id, "POS-02", "PENDING_ACTIVATION"],
    ]);
  });
});
