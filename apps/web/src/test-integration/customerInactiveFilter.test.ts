import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import { listCustomers } from "@/server/sales/customers";

/**
 * The Inactive Customers tab: `isActive = false` only, tenant-scoped, and composable with the
 * existing search and segment filters. All Customers is unchanged.
 */

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await db.customer.createMany({
    data: [
      { tenantId: IDS.tenantA, name: "Ali Active", phone: "9811000001", customerType: "RETAIL", isActive: true },
      { tenantId: IDS.tenantA, name: "Ali Inactive", phone: "9811000002", customerType: "RETAIL", isActive: false },
      { tenantId: IDS.tenantA, name: "Neha Inactive", phone: "9811000003", customerType: "WHOLESALE", isActive: false },
      { tenantId: IDS.tenantB, name: "Other Tenant Inactive", phone: "9811000004", customerType: "RETAIL", isActive: false },
    ],
  });
});

afterAll(async () => {
  await resetDatabase();
});

const names = async (params: Omit<Parameters<typeof listCustomers>[0], "tenantId">, tenantId: string = IDS.tenantA) =>
  (await listCustomers({ tenantId, ...params })).rows.map((r) => r.name).sort();

describe("listCustomers isActive filter", () => {
  it("All Customers (no filter) is unchanged: active and inactive, this tenant only", async () => {
    expect(await names({})).toEqual(["Ali Active", "Ali Inactive", "Neha Inactive"]);
  });

  it("isActive: false returns only this tenant's inactive customers", async () => {
    const page = await listCustomers({ tenantId: IDS.tenantA, isActive: false });
    expect(page.rows.map((r) => r.name).sort()).toEqual(["Ali Inactive", "Neha Inactive"]);
    expect(page.rows.every((r) => r.isActive === false)).toBe(true);
    expect(page.total).toBe(2);
  });

  it("combines with search and with segment", async () => {
    expect(await names({ isActive: false, query: "ali" })).toEqual(["Ali Inactive"]);
    expect(await names({ isActive: false, customerType: "WHOLESALE" })).toEqual(["Neha Inactive"]);
    expect(await names({ isActive: false, customerType: "RETAIL", query: "9811000002" })).toEqual(["Ali Inactive"]);
  });

  it("returns an empty page when nothing matches", async () => {
    const page = await listCustomers({ tenantId: IDS.tenantA, isActive: false, customerType: "DISTRIBUTOR" });
    expect(page.rows).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("never returns another tenant's inactive customers", async () => {
    expect(await names({ isActive: false })).not.toContain("Other Tenant Inactive");
    expect(await names({ isActive: false }, IDS.tenantB)).toEqual(["Other Tenant Inactive"]);
  });
});
