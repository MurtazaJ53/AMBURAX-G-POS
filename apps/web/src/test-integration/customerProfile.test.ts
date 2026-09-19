import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { getCustomerDetail } from "../server/sales/customers";
import { resetDatabase, seedTwoTenants, IDS } from "./db";

describe("Customer Profile & Details", () => {
  beforeAll(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await resetDatabase();
  });

  test("loads full customer profile and aggregates real purchase history", async () => {
    await seedTwoTenants();
    
    // We can fetch ownerA from db
    const ownerA = await db.user.findUniqueOrThrow({ where: { id: IDS.ownerA } });
    const tenantAId = IDS.tenantA;
    const tenantBId = IDS.tenantB;
    const storeAId = IDS.storeA;

    // 1. Create a customer
    const customer = await db.customer.create({
      data: {
        tenantId: tenantAId,
        name: "Valued Customer",
        phone: "1231231234",
        customerType: "WHOLESALE",
        creditLimitMinor: 500000,
        paymentTermsDays: 30,
      }
    });

    // 2. Create some sales for the customer
    
    // Valid completed sale
    await db.sale.create({
      data: {
        tenantId: tenantAId,
        storeId: storeAId,
        idempotencyKey: "1",
        billNumber: "B1",
        cashierUserId: ownerA.id,
        customerId: customer.id,
        status: "COMPLETED",
        subtotalMinor: 1000,
        discountMinor: 0,
        taxMinor: 100,
        totalMinor: 1100,
        paidMinor: 1100,
      }
    });

    // Another completed sale
    await db.sale.create({
      data: {
        tenantId: tenantAId,
        storeId: storeAId,
        idempotencyKey: "2",
        billNumber: "B2",
        cashierUserId: ownerA.id,
        customerId: customer.id,
        status: "COMPLETED",
        subtotalMinor: 2000,
        discountMinor: 0,
        taxMinor: 200,
        totalMinor: 2200,
        paidMinor: 2200,
      }
    });

    // 3. Fetch details
    const detail = await getCustomerDetail({ tenantId: tenantAId, id: customer.id });
    
    expect(detail).not.toBeNull();
    expect(detail?.name).toBe("Valued Customer");
    expect(detail?.customerType).toBe("WHOLESALE");
    expect(detail?.creditLimitMinor).toBe(500000);
    expect(detail?.paymentTermsDays).toBe(30);
    
    // 4. Verify aggregated stats
    expect(detail?.purchaseCount).toBe(2);
    expect(detail?.totalSpentMinor).toBe(3300); // 1100 + 2200

    // 5. Verify tenant isolation (Tenant B cannot read Tenant A's customer)
    const detailB = await getCustomerDetail({ tenantId: tenantBId, id: customer.id });
    expect(detailB).toBeNull();
  });
});
