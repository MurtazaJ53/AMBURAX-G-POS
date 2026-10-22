import { describe, it, expect, beforeEach } from "vitest";
import { assertWarehouseCompanyMatch, clearWarehouseCompanyCache } from "@/server/erp/documentSync";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport, ErpRequest, ErpResponse } from "@/server/erp/transport";
import { ErpClient } from "@/server/erp/client";
import { EnvErpCredentialProvider, type ErpEnvironment, type ErpCredentials } from "@/server/erp/config";

class MockTransport implements ErpTransport {
  public warehouseCompanyMap: Record<string, string | null> = {};
  public callCount = 0;

  async send(request: ErpRequest, _credentials: ErpCredentials): Promise<ErpResponse> {
    this.callCount++;
    const path = request.path;
    const match = path.match(/\/api\/resource\/Warehouse\/([^?]+)/);
    if (match) {
      const whName = decodeURIComponent(match[1]!);
      if (!(whName in this.warehouseCompanyMap)) {
        return {
          status: 404,
          body: { exc_type: "DoesNotExistError", message: `Warehouse ${whName} not found` },
        };
      }
      const comp = this.warehouseCompanyMap[whName];
      return {
        status: 200,
        body: { data: { company: comp } },
      };
    }
    return {
      status: 404,
      body: {},
    };
  }
}

describe("assertWarehouseCompanyMatch Guard & 5-minute Cache", () => {
  let transport: MockTransport;
  let client: ErpClient;
  const env: ErpEnvironment = {
    tenantId: "t-test",
    siteId: "frontend",
    clusterId: null,
    companyId: "Murtaza",
    version: null,
  };
  const ctx = { tenantId: "t-test", correlationId: "corr-123" };

  beforeEach(() => {
    clearWarehouseCompanyCache();
    transport = new MockTransport();
    client = new ErpClient(transport, new EnvErpCredentialProvider(), {});
  });

  it("1. Blocks when warehouseId is missing/null/empty", async () => {
    await expect(
      assertWarehouseCompanyMatch(client, env, ctx, {
        storeId: "store-1",
        warehouseId: null,
        expectedCompany: "Murtaza",
      })
    ).rejects.toThrow(/has no ERP warehouse provisioned/);
  });

  it("2. Blocks when expectedCompany is missing/null/empty", async () => {
    await expect(
      assertWarehouseCompanyMatch(client, env, ctx, {
        storeId: "store-1",
        warehouseId: "Stores - MUR",
        expectedCompany: null,
      })
    ).rejects.toThrow(/Tenant has no ERP company provisioned/);
  });

  it("3. Blocks fail-closed when warehouse does not exist in ERPNext (404)", async () => {
    await expect(
      assertWarehouseCompanyMatch(client, env, ctx, {
        storeId: "store-1",
        warehouseId: "NonExistent - MUR",
        expectedCompany: "Murtaza",
      })
    ).rejects.toThrow(/does not exist in ERPNext/);
  });

  it("4. Blocks fail-closed when ERPNext returns warehouse with empty/null company", async () => {
    transport.warehouseCompanyMap["Orphan - MUR"] = null;
    await expect(
      assertWarehouseCompanyMatch(client, env, ctx, {
        storeId: "store-1",
        warehouseId: "Orphan - MUR",
        expectedCompany: "Murtaza",
      })
    ).rejects.toThrow(/has no linked company/);
  });

  it("5. Blocks when warehouse company does not match expected company", async () => {
    transport.warehouseCompanyMap["Ring Road - SKF"] = "Shree Krishna Fashion";
    await expect(
      assertWarehouseCompanyMatch(client, env, ctx, {
        storeId: "store-1",
        warehouseId: "Ring Road - SKF",
        expectedCompany: "Murtaza",
      })
    ).rejects.toThrow(/Cross-tenant error: Warehouse "Ring Road - SKF" belongs to company "Shree Krishna Fashion", but tenant belongs to company "Murtaza"/);
  });

  it("6. Passes when warehouse company matches expected company, and uses 5-minute cache", async () => {
    transport.warehouseCompanyMap["Stores - MUR"] = "Murtaza";

    // Call 1: Fetches over transport
    await assertWarehouseCompanyMatch(client, env, ctx, {
      storeId: "store-1",
      warehouseId: "Stores - MUR",
      expectedCompany: "Murtaza",
    });
    expect(transport.callCount).toBe(1);

    // Call 2: Uses in-memory cache, no extra transport call
    await assertWarehouseCompanyMatch(client, env, ctx, {
      storeId: "store-1",
      warehouseId: "Stores - MUR",
      expectedCompany: "Murtaza",
    });
    expect(transport.callCount).toBe(1);
  });
});
