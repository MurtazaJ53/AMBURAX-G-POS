import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db, IDS, resetDatabase, seedTwoTenants } from "./db";
import { FakeErpTransport } from "@/server/erp/fakeTransport";
import { ErpStoreAdapter } from "@/server/erp/storeAdapter";

describe("ERP Store Provisioning", () => {
  let transport: FakeErpTransport;
  let adapter: ErpStoreAdapter;

  beforeEach(async () => {
    await resetDatabase();
    await seedTwoTenants();
    transport = new FakeErpTransport();
    adapter = new ErpStoreAdapter(transport);
    
    // Provision tenant A
    await db.tenant.update({
      where: { id: IDS.tenantA },
      data: {
        erpnextProvisionStatus: "PROVISIONED", erpnextCompanyId: "Amburax Retail",
        erpnextSiteId: "test-site.local",
      },
    });

    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
  });

  it("creates a new warehouse and marks store as provisioned", async () => {
    const store = await db.store.findUniqueOrThrow({ where: { id: IDS.storeA } });

    // Mock the lookup as not found (empty), and create as successful
    transport.script(
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 201, body: { data: { name: "Store A (SA) - AR" } } }
    );

    await adapter.syncStore(IDS.tenantA, IDS.storeA, "corr-1");

    expect(transport.sent.length).toBe(2);
    
    // Check lookup request
    expect(transport.sent[0]!.method).toBe("GET");
    // The filter is URL-encoded JSON now, so a name with quotes or brackets cannot alter the query.
    expect(decodeURIComponent(transport.sent[0]!.path)).toContain(`["warehouse_name","=","Store A (SA)"]`);

    // Check create request
    expect(transport.sent[1]!.method).toBe("POST");
    expect(transport.sent[1]!.body).toMatchObject({
      warehouse_name: "Store A (SA)",
      company: "Amburax Retail",
      is_group: 0,
    });

    const updated = await db.store.findUnique({ where: { id: IDS.storeA } });
    expect(updated?.erpnextProvisionStatus).toBe("PROVISIONED");
    expect(updated?.erpnextWarehouseId).toBe("Store A (SA) - AR");
  });

  it("re-lookup on 409 conflict", async () => {
    const store = await db.store.findUniqueOrThrow({ where: { id: IDS.storeA } });

    transport.script(
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 409, body: { error: "Duplicate" } },
      { kind: "respond", status: 200, body: { data: [{ name: "Store A (SA) - AR" }] } }
    );

    await adapter.syncStore(IDS.tenantA, IDS.storeA, "corr-2");

    expect(transport.sent.length).toBe(3);

    const updated = await db.store.findUnique({ where: { id: IDS.storeA } });
    expect(updated?.erpnextWarehouseId).toBe("Store A (SA) - AR");
  });

  it("idempotent skip if already fully provisioned in DB", async () => {
    await db.store.update({
      where: { id: IDS.storeA },
      data: { erpnextProvisionStatus: "PROVISIONED", erpnextWarehouseId: "Existing Warehouse" },
    });

    await adapter.syncStore(IDS.tenantA, IDS.storeA, "corr-3");
    
    // Should not send any network request
    expect(transport.sent.length).toBe(0);
  });
});
