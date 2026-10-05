import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { listCustomers, getCustomerDetail } from "../server/sales/customers";
import { resetDatabase, seedTwoTenants, IDS } from "./db";

describe("Customers List", () => {
  beforeAll(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await resetDatabase();
  });

  test("filters customers by type and query correctly", async () => {
    await seedTwoTenants();
    const tenantAId = IDS.tenantA;

    await db.customer.createMany({
      data: [
        { tenantId: tenantAId, name: "Ali Khan", phone: "9876543210", customerType: "RETAIL" },
        { tenantId: tenantAId, name: "Neha Jain", phone: "9876543211", customerType: "WHOLESALE" },
        { tenantId: tenantAId, name: "Pooja Desai", phone: "9876543212", customerType: "RETAIL" },
        { tenantId: tenantAId, name: "Karan Singh", phone: "9876543213", customerType: "DISTRIBUTOR" },
      ]
    });

    // Test unfiltered
    const all = await listCustomers({ tenantId: tenantAId });
    expect(all.total).toBe(4);

    // Test segment filter (RETAIL)
    const retail = await listCustomers({ tenantId: tenantAId, customerType: "RETAIL" });
    expect(retail.total).toBe(2);

    // Fetch detail to test the new schema
    const detail = await getCustomerDetail({ tenantId: tenantAId, id: retail.rows[0]!.id });
    expect(detail?.name).toBeTruthy();
    expect(detail?.recentSales).toEqual([]);
  });
});
