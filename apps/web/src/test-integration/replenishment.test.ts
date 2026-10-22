import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS, SEEDED_STOCK } from "./db";
import { createReplenishmentRequest, listReplenishment, setReorderRules } from "@/server/inventory/replenishment";
import { FakeErpTransport } from "@/server/erp/fakeTransport";
import { ErpReplenishmentAdapter } from "@/server/erp/replenishmentAdapter";

/** Low stock & replenishment (screen 32), against real PostgreSQL; ERPNext faked. */

const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const };
const A1 = COMMERCE_IDS.variantA1;
const A2 = COMMERCE_IDS.variantA2;
const name = (n: string) => ({ kind: "respond" as const, status: 200, body: { data: { name: n } } });
const none = { kind: "respond" as const, status: 200, body: { data: [] } };

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

afterAll(async () => {
  await resetDatabase();
});

describe("low stock list", () => {
  it("uses the 10-unit default without a rule, and the item's own level with one", async () => {
    // Seeded: A1 = 10 (at the default line), A2 = 4.
    let rows = await listReplenishment({ tenantId: IDS.tenantA, storeId: IDS.storeA });
    expect(rows.map((r) => r.variantId).sort()).toEqual([A1, A2].sort());
    expect(rows.every((r) => r.suggestedQty === null)).toBe(true);

    // A level of 3 takes A2 (4 on hand) off the list; A1 at level 20 / qty 15 suggests 10 + 15.
    const res = await setReorderRules({
      actor: owner,
      storeId: IDS.storeA,
      rules: [
        { variantId: A1, reorderLevel: 20, reorderQty: 15 },
        { variantId: A2, reorderLevel: 3, reorderQty: 5 },
      ],
    });
    expect(res).toEqual({ status: "ok", saved: 2, cleared: 0 });
    rows = await listReplenishment({ tenantId: IDS.tenantA, storeId: IDS.storeA });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ variantId: A1, quantity: SEEDED_STOCK.variantA1, reorderLevel: 20, suggestedQty: 25 });
  });

  it("never shows another tenant's stock", async () => {
    const rows = await listReplenishment({ tenantId: IDS.tenantA, storeId: IDS.storeB });
    expect(rows).toEqual([]);
  });
});

describe("reorder rules", () => {
  it("queues one ERPNext update per changed rule and skips unchanged ones", async () => {
    await setReorderRules({ actor: owner, storeId: IDS.storeA, rules: [{ variantId: A1, reorderLevel: 5, reorderQty: 10 }] });
    const again = await setReorderRules({
      actor: owner,
      storeId: IDS.storeA,
      rules: [{ variantId: A1, reorderLevel: 5, reorderQty: 10 }],
    });
    expect(again).toEqual({ status: "ok", saved: 0, cleared: 0 });
    expect(await db.outboxEvent.count({ where: { eventType: "ReorderRuleSet", entityId: A1 } })).toBe(1);
  });

  it("clears a rule when both fields are blank, and rejects half a rule", async () => {
    await setReorderRules({ actor: owner, storeId: IDS.storeA, rules: [{ variantId: A1, reorderLevel: 5, reorderQty: 10 }] });
    const cleared = await setReorderRules({
      actor: owner,
      storeId: IDS.storeA,
      rules: [{ variantId: A1, reorderLevel: null, reorderQty: null }],
    });
    expect(cleared).toEqual({ status: "ok", saved: 0, cleared: 1 });
    const half = await setReorderRules({
      actor: owner,
      storeId: IDS.storeA,
      rules: [{ variantId: A1, reorderLevel: 5, reorderQty: null }],
    });
    expect(half.status).toBe("validation_error");
  });

  it("refuses a store the actor has no rights in", async () => {
    const res = await setReorderRules({
      actor: owner,
      storeId: IDS.storeB,
      rules: [{ variantId: A1, reorderLevel: 5, reorderQty: 10 }],
    });
    expect(res.status).toBe("forbidden");
  });
});

describe("replenishment requests", () => {
  it("creates one request and one outbox event, and a retry does not duplicate", async () => {
    const key = randomUUID();
    const first = await createReplenishmentRequest({
      actor: owner,
      storeId: IDS.storeA,
      lines: [
        { variantId: A1, quantity: 12 },
        { variantId: A2, quantity: 0 },
      ],
      idempotencyKey: key,
    });
    expect(first).toMatchObject({ status: "ok", duplicate: false });
    const again = await createReplenishmentRequest({
      actor: owner,
      storeId: IDS.storeA,
      lines: [{ variantId: A1, quantity: 12 }],
      idempotencyKey: key,
    });
    expect(again).toMatchObject({ status: "ok", duplicate: true });
    expect(await db.replenishmentRequestLine.count()).toBe(1);
    expect(await db.outboxEvent.count({ where: { eventType: "ReplenishmentRequested" } })).toBe(1);
  });

  it("rejects an empty or invalid request", async () => {
    const empty = await createReplenishmentRequest({
      actor: owner,
      storeId: IDS.storeA,
      lines: [{ variantId: A1, quantity: 0 }],
      idempotencyKey: randomUUID(),
    });
    expect(empty.status).toBe("validation_error");
    const negative = await createReplenishmentRequest({
      actor: owner,
      storeId: IDS.storeA,
      lines: [{ variantId: A1, quantity: -3 }],
      idempotencyKey: randomUUID(),
    });
    expect(negative.status).toBe("validation_error");
  });
});

describe("ERPNext sync", () => {
  beforeEach(async () => {
    await db.tenant.update({
      where: { id: IDS.tenantA },
      data: { erpnextProvisionStatus: "PROVISIONED", erpnextCompanyId: "Amburax Retail", erpnextSiteId: "test-site.local" },
    });
    await db.store.update({ where: { id: IDS.storeA }, data: { erpnextWarehouseId: "Stores - AR" } });
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
  });

  it("writes this store's Item Reorder row and keeps other warehouses' rows", async () => {
    await setReorderRules({ actor: owner, storeId: IDS.storeA, rules: [{ variantId: A1, reorderLevel: 6, reorderQty: 24 }] });
    const transport = new FakeErpTransport().script({
      kind: "respond",
      status: 200,
      body: {
        data: {
          reorder_levels: [
            { warehouse: "Other - AR", warehouse_reorder_level: 2, warehouse_reorder_qty: 4, material_request_type: "Purchase" },
            { warehouse: "Stores - AR", warehouse_reorder_level: 1, warehouse_reorder_qty: 1, material_request_type: "Purchase" },
          ],
        },
      },
    });
    await new ErpReplenishmentAdapter(transport).syncRule(IDS.tenantA, IDS.storeA, A1, "corr-rr");

    const put = transport.sent.find((r) => r.method === "PUT")!;
    expect(put.path).toBe(`/api/resource/Item/${A1}`);
    expect(put.body).toEqual({
      reorder_levels: [
        { warehouse: "Other - AR", warehouse_reorder_level: 2, warehouse_reorder_qty: 4, material_request_type: "Purchase" },
        { warehouse: "Stores - AR", warehouse_reorder_level: 6, warehouse_reorder_qty: 24, material_request_type: "Purchase" },
      ],
    });
    const rule = await db.reorderRule.findFirstOrThrow({ where: { variantId: A1 } });
    expect(rule.erpSyncStatus).toBe("SYNCED");
  });

  it("sends a request as a draft Material Request of type Purchase", async () => {
    const res = await createReplenishmentRequest({
      actor: owner,
      storeId: IDS.storeA,
      lines: [{ variantId: A1, quantity: 12 }],
      note: "Diwali stock-up",
      idempotencyKey: randomUUID(),
    });
    if (res.status !== "ok") throw new Error("request failed");
    const transport = new FakeErpTransport().script(none, name("MAT-MR-0001"));
    const erpName = await new ErpReplenishmentAdapter(transport).syncRequest(IDS.tenantA, res.requestId, "corr-mr");

    expect(erpName).toBe("MAT-MR-0001");
    const post = transport.sent.find((r) => r.method === "POST")!;
    expect(post.path).toBe("/api/resource/Material Request");
    expect(post.body).toMatchObject({
      material_request_type: "Purchase",
      set_warehouse: "Stores - AR",
      title: `amburax-replenishment-id:${res.requestId}`,
    });
    expect((post.body as { items: unknown[] }).items[0]).toMatchObject({ item_code: A1, qty: 12, description: "Diwali stock-up" });
    // Draft: never submitted by AMBURAX.
    expect(transport.sent.some((r) => r.method === "PUT")).toBe(false);
    expect(await db.replenishmentRequest.findUniqueOrThrow({ where: { id: res.requestId } })).toMatchObject({
      erpnextName: "MAT-MR-0001",
      erpSyncStatus: "SYNCED",
    });
  });
});
