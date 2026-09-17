import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, IDS, COMMERCE_IDS, resetDatabase, seedTwoTenants, seedCommerce } from "./db";
import { createSale } from "@/server/sales/saleService";
import { openPosSession } from "@/server/pos/posSessionService";
import { disablePosDevice, repairPosDevice } from "@/server/pos/posDeviceLifecycle";
import { randomUUID } from "node:crypto";
import { derivePosDeviceStatus, hashPairingCode } from "@/server/pos/posDevice";
import { activatePosDevice } from "@/server/pos/posDeviceActivation";

const STORE_A2_ID = "s-aaaaaaaaaaaaaaaaaaaaaaa2";

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  
  // Create a second store for Tenant A to test cross-store isolation
  await db.store.create({
    data: {
      id: STORE_A2_ID,
      tenantId: IDS.tenantA,
      name: "Store A2",
      code: "A2",
      currency: "INR",
      addressLine: "2 A Street",
      city: "Mumbai",
      state: "MH",
      isDefault: false,
    },
  });

  // Promote staffA and give them STORE_MANAGER in storeA but NOT in storeA2
  await db.user.update({
    where: { id: IDS.staffA },
    data: { tenantRole: "STAFF" }
  });
  await db.storeMembership.create({
    data: { tenantId: IDS.tenantA, userId: IDS.staffA, storeId: IDS.storeA, role: "STORE_MANAGER" },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

const ACTOR_A = {
  tenantId: IDS.tenantA,
  userId: IDS.ownerA,
  tenantRole: "OWNER" as const,
  membershipRole: null,
  storeId: IDS.storeA,
};

const ACTOR_STAFF_A_STORE_A = {
  tenantId: IDS.tenantA,
  userId: IDS.staffA,
  tenantRole: "STAFF" as const,
  membershipRole: "STORE_MANAGER",
  storeId: IDS.storeA,
};

const ACTOR_STAFF_A_STORE_A2 = {
  tenantId: IDS.tenantA,
  userId: IDS.staffA,
  tenantRole: "STAFF" as const,
  membershipRole: null, // No membership in A2
  storeId: STORE_A2_ID,
};

async function createPairedDevice(code: string, storeId: string = IDS.storeA, tenantId: string = IDS.tenantA, ownerId: string = IDS.ownerA) {
  const device = await db.posDevice.create({
    data: {
      tenantId: tenantId,
      storeId: storeId,
      name: "Till " + code,
      code,
      createdByUserId: ownerId, // Must match tenant
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

    const disableResult = await disablePosDevice({
      actor: ACTOR_A,
      posDeviceId: device.id,
      correlationId: "corr-3",
    });
    expect(disableResult.status).toBe("ok");

    const freshSession = await db.posSession.findUnique({ where: { id: session.session.id } });
    expect(freshSession?.closedAt).toBeNull();
    
    const freshDevice = await db.posDevice.findUnique({ where: { id: device.id } });
    expect(freshDevice?.disabledAt).not.toBeNull();
    expect(freshDevice?.activeSessionId).toBe(session.session.id);

    const saleResult = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: randomUUID(),
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
      payment: { method: "CASH" },
      posSessionId: session.session.id,
      correlationId: "corr-4",
    });

    expect(saleResult.status).toBe("invalid_session");

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
    const { device } = await createPairedDevice("POS-103");
    
    await disablePosDevice({ actor: ACTOR_A, posDeviceId: device.id, correlationId: "corr-d" });

    const repairResult = await repairPosDevice({ actor: ACTOR_A, posDeviceId: device.id, correlationId: "corr-r" });
    expect(repairResult.status).toBe("ok");
    if (repairResult.status !== "ok") return;

    const updatedDevice = await db.posDevice.findUnique({ where: { id: device.id } });
    expect(updatedDevice?.disabledAt).toBeNull();
    expect(updatedDevice?.activatedAt).toBeNull();
    expect(updatedDevice?.deviceSecretHash).toBeNull();
    expect(updatedDevice?.pairingCodeHash).not.toBeNull();
    
    expect(derivePosDeviceStatus(updatedDevice as any)).toBe("PENDING_ACTIVATION");

    const reactivate = await activatePosDevice({ pairingCode: repairResult.pairingCode, ip: "127.0.0.1", correlationId: "corr-new" });
    expect(reactivate.status).toBe("ok");
  });
});

describe("POS Terminal Lifecycle Store Authorization", () => {
  it("allows Store A manager to disable Store A terminal", async () => {
    const { device } = await createPairedDevice("POS-AUTH-1", IDS.storeA, IDS.tenantA);
    
    const res = await disablePosDevice({
      actor: ACTOR_STAFF_A_STORE_A,
      posDeviceId: device.id,
      correlationId: "corr-auth-1",
    });
    expect(res.status).toBe("ok");
  });

  it("forbids Store A manager from disabling Store B terminal and produces ZERO state changes", async () => {
    // Note: Store B terminal is Tenant B, but we will test Tenant A Store A2 to test cross-store within same tenant
    const { device } = await createPairedDevice("POS-AUTH-2", STORE_A2_ID, IDS.tenantA);
    
    // A staff authenticated to Store A attempts to disable A2's terminal
    const res = await disablePosDevice({
      actor: ACTOR_STAFF_A_STORE_A, // Has STORE_MANAGER at storeA, requesting posDeviceId at storeA2
      posDeviceId: device.id,
      correlationId: "corr-auth-2",
    });
    expect(res.status).toBe("forbidden");

    // Prove ZERO state change
    const freshDevice = await db.posDevice.findUnique({ where: { id: device.id } });
    expect(freshDevice?.disabledAt).toBeNull();
    
    // Prove ZERO AuditLog and Outbox
    const audits = await db.auditLog.count({ where: { correlationId: "corr-auth-2" } });
    expect(audits).toBe(0);
    const outbox = await db.outboxEvent.count({ where: { correlationId: "corr-auth-2" } });
    expect(outbox).toBe(0);
  });

  it("allows Store A manager to re-pair Store A terminal", async () => {
    const { device } = await createPairedDevice("POS-AUTH-3", IDS.storeA, IDS.tenantA);
    await disablePosDevice({ actor: ACTOR_STAFF_A_STORE_A, posDeviceId: device.id, correlationId: "corr-auth-3d" });

    const res = await repairPosDevice({
      actor: ACTOR_STAFF_A_STORE_A,
      posDeviceId: device.id,
      correlationId: "corr-auth-3r",
    });
    expect(res.status).toBe("ok");
  });

  it("forbids Store A manager from re-pairing Store A2 terminal and produces ZERO state changes", async () => {
    const { device } = await createPairedDevice("POS-AUTH-4", STORE_A2_ID, IDS.tenantA);
    
    // Manually disable the terminal for test setup since ACTOR_A doesn't have Store A2 role directly
    await db.posDevice.update({
      where: { id: device.id },
      data: { disabledAt: new Date() }
    });
    
    // Store A manager attempts to re-pair it
    const res = await repairPosDevice({
      actor: ACTOR_STAFF_A_STORE_A,
      posDeviceId: device.id,
      correlationId: "corr-auth-4r",
    });
    expect(res.status).toBe("forbidden");

    // Prove ZERO state change
    const freshDevice = await db.posDevice.findUnique({ where: { id: device.id } });
    expect(freshDevice?.disabledAt).not.toBeNull(); // Still disabled
    expect(freshDevice?.pairingCodeHash).toBeNull(); // No new pairing code
    
    // Prove ZERO AuditLog and Outbox
    const audits = await db.auditLog.count({ where: { correlationId: "corr-auth-4r" } });
    expect(audits).toBe(0);
    const outbox = await db.outboxEvent.count({ where: { correlationId: "corr-auth-4r" } });
    expect(outbox).toBe(0);
  });

  it("forbids Tenant A actor from modifying Tenant B terminal", async () => {
    const { device } = await createPairedDevice("POS-AUTH-5", IDS.storeB, IDS.tenantB, IDS.ownerB);
    
    const res = await disablePosDevice({
      actor: ACTOR_STAFF_A_STORE_A,
      posDeviceId: device.id,
      correlationId: "corr-auth-5",
    });
    
    // Our logic actually yields not_found because of `tenantId` in the `where` clause.
    // That is perfectly secure. We just ensure it doesn't change anything.
    expect(res.status).toBe("not_found");
    
    const freshDevice = await db.posDevice.findUnique({ where: { id: device.id } });
    expect(freshDevice?.disabledAt).toBeNull();
  });
});

