import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { listCustomers } from "../server/sales/customers";
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
    expect(retail.rows.every(r => r.customerType === "RETAIL")).toBe(true);

    // Test segment filter (WHOLESALE)
    const wholesale = await listCustomers({ tenantId: tenantAId, customerType: "WHOLESALE" });
    expect(wholesale.total).toBe(1);
    expect(wholesale.rows[0].name).toBe("Neha Jain");

    // Test search query only
    const search = await listCustomers({ tenantId: tenantAId, query: "Karan" });
    expect(search.total).toBe(1);
    expect(search.rows[0].name).toBe("Karan Singh");

    // Test search + segment (No match)
    const noMatch = await listCustomers({ tenantId: tenantAId, query: "Karan", customerType: "RETAIL" });
    expect(noMatch.total).toBe(0);

    // Test search + segment (Match)
    const match = await listCustomers({ tenantId: tenantAId, query: "Ali", customerType: "RETAIL" });
    expect(match.total).toBe(1);
    expect(match.rows[0].name).toBe("Ali Khan");
  });
});
