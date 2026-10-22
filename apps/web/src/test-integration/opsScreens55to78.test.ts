import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { csvCell, exportCsv, getMultiStore, getOperationsCenter, getSystemHealth, retryFailedSync } from "@/server/ops/operations";
import { getPosConfig, savePosConfig } from "@/server/pos/posConfig";
import { createHeldBill } from "@/server/sales/heldBillService";

/** Screens 55, 68/81, 69-71, 74, 78 against real PostgreSQL. */

const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const };
const staff = { tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF" as const };
const ownerB = { tenantId: IDS.tenantB, userId: IDS.ownerB, tenantRole: "OWNER" as const };

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

afterAll(async () => {
  await resetDatabase();
});

async function failedEvent(tenantId: string) {
  return db.outboxEvent.create({
    data: {
      tenantId,
      eventType: "SaleCompleted",
      correlationId: "c",
      payload: {},
      idempotencyKey: `k-${Math.random()}`,
      attempts: 8,
      deadLetteredAt: new Date(),
      lastError: "ERPNext said no",
    },
  });
}

describe("data export (78)", () => {
  it("neutralises spreadsheet formulas and quotes separators", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+91 98")).toBe("'+91 98");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
  });

  it("is owner-only, tenant-scoped and audited", async () => {
    expect((await exportCsv({ actor: staff, kind: "customers" })).status).toBe("forbidden");
    await db.customer.create({ data: { tenantId: IDS.tenantB, name: "Other tenant's customer" } });
    const res = await exportCsv({ actor: owner, kind: "customers" });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.csv.split("\r\n")[0]).toBe("Name,Phone,Email,GSTIN,Active,Added");
    expect(res.csv).not.toContain("Other tenant's customer");
    expect(await db.auditLog.count({ where: { tenantId: IDS.tenantA, action: "DataExported" } })).toBe(1);
  });
});

describe("system health (68, 81)", () => {
  it("counts by type and lets only the owner of that tenant retry a failure", async () => {
    const e = await failedEvent(IDS.tenantA);
    const health = await getSystemHealth({ tenantId: IDS.tenantA });
    expect(health.types).toEqual([expect.objectContaining({ eventType: "SaleCompleted", failed: 1, pending: 0 })]);

    expect((await retryFailedSync({ actor: staff, eventId: e.id })).status).toBe("forbidden");
    expect((await retryFailedSync({ actor: ownerB, eventId: e.id })).status).toBe("not_found");
    expect((await retryFailedSync({ actor: owner, eventId: e.id })).status).toBe("ok");
    const after = await db.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.deadLetteredAt).toBeNull();
    expect(after.attempts).toBe(0);
    expect((await retryFailedSync({ actor: owner, eventId: e.id })).status).toBe("not_found");
  });
});

describe("operations center (55) and multi-store (69-71)", () => {
  it("collects today's work for one store and lists only this tenant's stores", async () => {
    await failedEvent(IDS.tenantA);
    await db.outboxEvent.updateMany({ data: { storeId: IDS.storeA } });
    const ops = await getOperationsCenter({ tenantId: IDS.tenantA, storeId: IDS.storeA });
    expect(ops.failedSyncs).toBe(1);
    expect(ops.approvals).toEqual({ corrections: 0, leave: 0, variances: 0 });
    expect(ops.metrics.billCount).toBe(0);

    const stores = await getMultiStore({ tenantId: IDS.tenantA });
    expect(stores.length).toBeGreaterThan(0);
    const ids = new Set((await db.store.findMany({ where: { tenantId: IDS.tenantA }, select: { id: true } })).map((s) => s.id));
    expect(stores.every((s) => ids.has(s.storeId))).toBe(true);
    expect(stores[0]!.marginBp).toBeNull();
  });
});

describe("POS configuration (74)", () => {
  it("owner sets held-bill hours within 1-24, and new held bills use them", async () => {
    const base = (await getPosConfig(IDS.tenantA, IDS.storeA))!;
    expect(base).toEqual({ heldBillHours: 24, lateGraceMinutes: 10, halfDayPercent: 50 });
    expect((await savePosConfig({ actor: staff, storeId: IDS.storeA, config: { ...base, heldBillHours: 2 } })).status).toBe("forbidden");
    expect((await savePosConfig({ actor: owner, storeId: IDS.storeA, config: { ...base, heldBillHours: 25 } })).status).toBe("validation_error");
    expect((await savePosConfig({ actor: ownerB, storeId: IDS.storeA, config: { ...base, heldBillHours: 2 } })).status).toBe("not_found");
    expect((await savePosConfig({ actor: owner, storeId: IDS.storeA, config: { ...base, heldBillHours: 2 } })).status).toBe("ok");

    const before = Date.now();
    const held = await createHeldBill({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      heldByUserId: IDS.ownerA,
      idempotencyKey: "hold-1",
      items: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
    });
    const hours = (held.heldBill.expiresAt.getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(1.99);
    expect(hours).toBeLessThan(2.01);
  });
});
