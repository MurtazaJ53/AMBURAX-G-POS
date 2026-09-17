import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, IDS, COMMERCE_IDS, resetDatabase, seedTwoTenants, seedCommerce } from "./db";
import { createSale } from "@/server/sales/saleService";
import { openPosSession } from "@/server/pos/posSessionService";
import { disablePosDevice, repairPosDevice } from "@/server/pos/posDeviceLifecycle";
import { randomUUID } from "node:crypto";
import { derivePosDeviceStatus, hashPairingCode, normalizePairingCode } from "@/server/pos/posDevice";
import { activatePosDevice } from "@/server/pos/posDeviceActivation";
import { outboxIdempotencyKey } from "@/server/events/outbox";

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

afterAll(async () => {
  await db.$disconnect();
});

const ACTOR_A = {
  tenantId: IDS.tenantA,
  userId: IDS.ownerA,
  tenantRole: "OWNER" as const,
  membershipRole: null,
};

async function createPairedDevice(code: string) {
  const device = await db.posDevice.create({
    data: {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      name: "Till " + code,
      code,
      createdByUserId: IDS.ownerA,
      pairingCodeHash: hashPairingCode("1111"),
      pairingExpiresAt: new Date(Date.now() + 100000),
    },
  });

  const activation = await activatePosDevice({
    pairingCode: "1111",
    ip: "127.0.0.1",
    correlationId: "corr-1",
  });
  if (activation.status !== "ok") throw new Error("Failed to pair");

  return activation;
}

describe("POS Terminal Lifecycle (Disable & Re-pair)", () => {
  it("allows a sale on an active terminal with an open shift", async () => {
    const { device } = await createPairedDevice("POS-100");
    const session = await openPosSession({
      actor: ACTOR_A,
      posDeviceId: device.id,
      correlationId: "corr-2",
    });
    if (session.status !== "ok") throw new Error("Failed to open session");

    const sale = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: randomUUID(),
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
      payment: { method: "CASH" },
      posSessionId: session.session.id,
      correlationId: "corr-3",
    });

    expect(sale.status).toBe("ok");
    
    // Validate outbox
    const events = await db.outboxEvent.findMany({ where: { eventType: "SaleCompleted" } });
    expect(events).toHaveLength(1);
  });

  it("blocks sales and does NOT close the shift when a terminal is disabled", async () => {
    const { device } = await createPairedDevice("POS-101");
    
    const session = await openPosSession({
      actor: ACTOR_A,
      posDeviceId: device.id,
      correlationId: "corr-2",
    });
    if (session.status !== "ok") throw new Error("Failed to open session");

    // 1. Admin disables terminal
    const disableResult = await disablePosDevice({
      actor: ACTOR_A,
      posDeviceId: device.id,
      correlationId: "corr-3",
    });
    expect(disableResult.status).toBe("ok");

    // 2. Terminal is unusable for new POS sales, shift remains open
    const freshSession = await db.posSession.findUnique({ where: { id: session.session.id } });
    expect(freshSession?.closedAt).toBeNull();
    
    const freshDevice = await db.posDevice.findUnique({ where: { id: device.id } });
    expect(freshDevice?.disabledAt).not.toBeNull();
    expect(freshDevice?.activeSessionId).toBe(session.session.id); // Open shift remains tracked

    // 3. Failed sale creates no side effects
    const saleResult = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: randomUUID(),
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
      payment: { method: "CASH" },
      posSessionId: session.session.id, // Using existing session
      correlationId: "corr-4",
    });

    expect(saleResult.status).toBe("invalid_session");
    if (saleResult.status === "invalid_session") {
      expect(saleResult.reason).toBe("The terminal for this shift has been disabled.");
    }

    // 4. Prove no sale artifacts exist
    const sales = await db.sale.count();
    expect(sales).toBe(0);
    const payments = await db.salePayment.count();
    expect(payments).toBe(0);
    const events = await db.outboxEvent.count({ where: { eventType: "SaleCompleted" } });
    expect(events).toBe(0);
  });

  it("emits PosDeviceDisabled outbox and audit events securely", async () => {
    const { device } = await createPairedDevice("POS-102");
    
    await disablePosDevice({
      actor: ACTOR_A,
      posDeviceId: device.id,
      correlationId: "corr-disable",
    });

    const outbox = await db.outboxEvent.findFirstOrThrow({ where: { eventType: "PosDeviceDisabled" } });
    expect(outbox.tenantId).toBe(IDS.tenantA);
    expect(outbox.entityId).toBe(device.id);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "PosDeviceDisabled" } });
    expect(audit.correlationId).toBe("corr-disable");
  });

  it("handles re-pairing securely", async () => {
    const { device, deviceSecret } = await createPairedDevice("POS-103");
    
    await disablePosDevice({ actor: ACTOR_A, posDeviceId: device.id, correlationId: "corr-d" });

    // Ensure re-pairing disabled devices works
    const repairResult = await repairPosDevice({ actor: ACTOR_A, posDeviceId: device.id, correlationId: "corr-r" });
    expect(repairResult.status).toBe("ok");
    
    if (repairResult.status !== "ok") return;

    // Check that it's no longer disabled, but pending activation
    const updatedDevice = await db.posDevice.findUnique({ where: { id: device.id } });
    expect(updatedDevice?.disabledAt).toBeNull();
    expect(updatedDevice?.activatedAt).toBeNull(); // Reset
    expect(updatedDevice?.deviceSecretHash).toBeNull(); // Reset
    expect(updatedDevice?.pairingCodeHash).not.toBeNull();
    
    expect(derivePosDeviceStatus(updatedDevice as any)).toBe("PENDING_ACTIVATION");

    // The old device secret is completely gone, new code is ready to use
    const reactivate = await activatePosDevice({ pairingCode: repairResult.pairingCode, ip: "127.0.0.1", correlationId: "corr-new" });
    expect(reactivate.status).toBe("ok");
  });
});
