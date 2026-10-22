import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, IDS, resetDatabase, seedTwoTenants } from "./db";
import { addStore } from "@/server/tenant/addStore";

/** Screen 70: a second store joins the business's company and queues its ERPNext warehouse. */

const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const };
const staff = { tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF" as const };
const valid = { name: "Surat Ring Road", code: "surat2", addressLine: "Ring Road", city: "Surat", state: "Gujarat", postalCode: "395002" };

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});

afterAll(async () => {
  await resetDatabase();
});

describe("adding a store", () => {
  it("creates it in the business's company, makes the owner a member and queues its warehouse", async () => {
    const company = await db.company.create({ data: { tenantId: IDS.tenantA, name: "Tenant A Retail", code: "TAR", currency: "INR" } });
    const res = await addStore({ actor: owner, ...valid });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    const store = await db.store.findUniqueOrThrow({ where: { id: res.storeId } });
    expect(store).toMatchObject({ tenantId: IDS.tenantA, code: "SURAT2", companyId: company.id, currency: "INR", isDefault: false });
    expect(await db.storeMembership.count({ where: { storeId: res.storeId, userId: IDS.ownerA, role: "OWNER" } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { entityId: res.storeId, eventType: "StoreCreated" } })).toBe(1);
    expect(await db.auditLog.count({ where: { tenantId: IDS.tenantA, action: "StoreAdded" } })).toBe(1);
  });

  it("is owner-only, needs a real Indian state, and refuses a code already used", async () => {
    expect((await addStore({ actor: staff, ...valid })).status).toBe("forbidden");
    expect(await addStore({ actor: owner, ...valid, state: "Atlantis" })).toMatchObject({ status: "validation_error", field: "state" });
    expect(await addStore({ actor: owner, ...valid, code: "a" })).toMatchObject({ status: "validation_error", field: "code" });
    expect((await addStore({ actor: owner, ...valid })).status).toBe("ok");
    expect(await addStore({ actor: owner, ...valid, name: "Another" })).toMatchObject({ status: "conflict" });
  });
});
