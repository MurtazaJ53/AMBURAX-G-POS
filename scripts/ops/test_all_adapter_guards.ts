import { db } from "../src/server/db";
import { ErpInventoryAdapter } from "../src/server/erp/inventoryAdapter";
import { ErpSaleAdapter } from "../src/server/erp/saleAdapter";
import { ErpReturnAdapter } from "../src/server/erp/returnAdapter";
import { ErpPurchaseAdapter } from "../src/server/erp/purchaseAdapter";
import { ErpTransferAdapter } from "../src/server/erp/transferAdapter";
import { clearWarehouseCompanyCache } from "../src/server/erp/documentSync";
import type { ErpTransport, ErpRequest, ErpResponse } from "../src/server/erp/transport";
import type { ErpCredentials } from "../src/server/erp/config";

class MockTransport implements ErpTransport {
  public warehouseCompanyMap: Record<string, string | null> = {
    "Surat Ring Road (SURAT2) - MUR": "Murtaza",
    "TN (MAIN) - MUR": "Murtaza",
    "Transit - MUR": "Murtaza",
    "Stores - SKF": "Shree Krishna Fashion",
  };
  public calls: string[] = [];

  async send(req: ErpRequest, _credentials: ErpCredentials): Promise<ErpResponse> {
    this.calls.push(`${req.method} ${req.path}`);
    if (req.path.includes("/api/resource/Warehouse?filters=")) {
      return {
        status: 200,
        body: { data: [{ name: "Transit - MUR" }] },
      };
    }
    const match = req.path.match(/\/api\/resource\/Warehouse\/([^?]+)/);
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
      status: 200,
      body: { data: [] },
    };
  }
}

async function runAudit() {
  console.log("================================================================================");
  console.log("   STEP 1: LIVE MULTI-ADAPTER FAIL-CLOSED GUARD VERIFICATION");
  console.log("================================================================================");

  // 1. Audit stores and warehouse mappings for Murtaza & Tenant-A
  console.log("\n--- AUDIT: LIVE STORES & WAREHOUSE MAPPINGS ---");
  const tenants = await db.tenant.findMany({
    where: { slug: { in: ["murtaza-7cfa22", "tenant-a"] } },
    include: { stores: true, companies: true },
    orderBy: { slug: "asc" },
  });

  for (const t of tenants) {
    console.log(`Tenant [${t.slug}] "${t.name}" (ID: ${t.id})`);
    console.log(`  erpnextCompanyId in tenant row: "${t.erpnextCompanyId}"`);
    for (const s of t.stores) {
      console.log(`  - Store [${s.code}] "${s.name}" (ID: ${s.id}): warehouse = "${s.erpnextWarehouseId}", companyId = "${s.companyId}"`);
    }
  }

  // 2. Audit outbox rows for the two dismissed test events
  console.log("\n--- AUDIT: DISMISSED TEST EVENTS IN OUTBOX ---");
  const testIds = ["cmvjd9wa6000mg2tt81oy1mno", "cmvjddbh9000myupi017lgxoz"];
  const outboxRows = await db.outboxEvent.findMany({
    where: { id: { in: testIds } },
    select: { id: true, eventType: true, publishedAt: true, deadLetteredAt: true, lastError: true },
  });
  for (const row of outboxRows) {
    console.log(JSON.stringify(row, null, 2));
  }

  // 3. Test Fail-Closed Guard across all 5 Adapters using Murtaza existing entities
  console.log("\n--- TESTING FAIL-CLOSED GUARD ACROSS ALL 5 ADAPTERS ---");
  const transport = new MockTransport();
  const correlationId = "corr-adapter-guard-test";

  const tenant = await db.tenant.findUnique({ where: { slug: "murtaza-7cfa22" }, include: { stores: true } });
  if (!tenant) throw new Error("Murtaza tenant not found");
  const variant = await db.productVariant.findFirst({ where: { tenantId: tenant.id } });
  const user = await db.user.findFirst({ where: { tenantId: tenant.id } });
  const validStore = tenant.stores[0]!;

  // Temporary cross-tenant store (pointing to Shree Krishna Fashion warehouse, linked to Murtaza company)
  const murtazaCompany = await db.company.findFirst({ where: { tenantId: tenant.id } });
  const crossStore = await db.store.create({
    data: {
      tenantId: tenant.id,
      companyId: murtazaCompany?.id,
      name: "Temp Cross Store",
      code: `TC_${Date.now().toString().slice(-4)}`,
      currency: "INR",
      addressLine: "Test",
      city: "Surat",
      state: "Gujarat",
      erpnextWarehouseId: "Stores - SKF",
    },
  });

  // Adapter 1: Inventory
  console.log("\n[1/5] Testing ErpInventoryAdapter...");
  const movement = await db.stockMovement.create({
    data: {
      tenantId: tenant.id,
      storeId: crossStore.id,
      variantId: variant!.id,
      quantityDelta: 1,
      balanceAfter: 1,
      type: "ADJUSTMENT",
      unitCostMinor: 1000,
      idempotencyKey: `m-test-${Date.now()}`,
    },
  });
  const invAdapter = new ErpInventoryAdapter(transport);
  clearWarehouseCompanyCache();
  try {
    await invAdapter.syncMovement(tenant.id, movement.id, correlationId);
    console.error("FAIL: InventoryAdapter allowed cross-tenant warehouse!");
  } catch (err: any) {
    console.log("PASS: InventoryAdapter correctly blocked:", err.message);
  }

  // Adapter 2: Sale
  console.log("\n[2/5] Testing ErpSaleAdapter...");
  const sale = await db.sale.create({
    data: {
      tenantId: tenant.id,
      storeId: crossStore.id,
      cashierUserId: user!.id,
      billNumber: `BILL_${Date.now().toString().slice(-4)}`,
      idempotencyKey: `sale-test-${Date.now()}`,
      subtotalMinor: 1000,
      taxMinor: 0,
      totalMinor: 1000,
      paidMinor: 1000,
      status: "COMPLETED",
      items: {
        create: [
          {
            variantId: variant!.id,
            skuSnapshot: "SKU",
            nameSnapshot: "Name",
            quantity: 1,
            unitPriceMinor: 1000,
            taxRateBp: 0,
            taxMinor: 0,
            lineTotalMinor: 1000,
          },
        ],
      },
      payments: {
        create: [{ method: "CASH", amountMinor: 1000, status: "CONFIRMED" }],
      },
    },
  });
  const saleAdapter = new ErpSaleAdapter(transport);
  clearWarehouseCompanyCache();
  try {
    await saleAdapter.syncSale(tenant.id, sale.id, correlationId);
    console.error("FAIL: SaleAdapter allowed cross-tenant warehouse!");
  } catch (err: any) {
    console.log("PASS: SaleAdapter correctly blocked:", err.message);
  }

  // Adapter 3: Return
  console.log("\n[3/5] Testing ErpReturnAdapter...");
  // Simulate original sale already having an erpInvoiceId so ReturnAdapter proceeds to warehouse guard
  await db.sale.update({
    where: { id: sale.id },
    data: { erpInvoiceId: "ACC-SINV-2026-00001" },
  });
  const saleItem = await db.saleItem.findFirst({ where: { saleId: sale.id } });
  const saleReturn = await db.saleReturn.create({
    data: {
      tenantId: tenant.id,
      storeId: crossStore.id,
      originalSaleId: sale.id,
      totalRefundMinor: 1000,
      idempotencyKey: `ret-test-${Date.now()}`,
      status: "COMPLETED",
      reason: "Defective",
      items: {
        create: [
          {
            originalSaleItemId: saleItem!.id,
            quantity: 1,
            refundMinor: 1000,
          },
        ],
      },
      payments: {
        create: [{ method: "CASH", amountMinor: 1000 }],
      },
    },
  });
  const returnAdapter = new ErpReturnAdapter(transport);
  clearWarehouseCompanyCache();
  try {
    await returnAdapter.syncReturn(tenant.id, saleReturn.id, correlationId);
    console.error("FAIL: ReturnAdapter allowed cross-tenant warehouse!");
  } catch (err: any) {
    console.log("PASS: ReturnAdapter correctly blocked:", err.message);
  }

  // Adapter 4: Purchase
  console.log("\n[4/5] Testing ErpPurchaseAdapter...");
  let supplier = await db.supplier.findFirst({ where: { tenantId: tenant.id } });
  if (!supplier) {
    supplier = await db.supplier.create({
      data: {
        tenantId: tenant.id,
        name: "Test Supplier",
      },
    });
  }
  const receipt = await db.purchaseReceipt.create({
    data: {
      tenantId: tenant.id,
      storeId: crossStore.id,
      supplierId: supplier.id,
      supplierInvoiceNo: `INV-${Date.now().toString().slice(-4)}`,
      taxableMinor: 5000,
      inputTaxMinor: 0,
      totalMinor: 5000,
      createdByUserId: user!.id,
      idempotencyKey: `rcpt-${Date.now()}`,
      lines: {
        create: [
          {
            variantId: variant!.id,
            quantity: 1,
            unitCostMinor: 5000,
            gstRateBp: 0,
            taxableMinor: 5000,
            inputTaxMinor: 0,
            stockMovementId: movement.id,
          },
        ],
      },
    },
  });
  const purchaseAdapter = new ErpPurchaseAdapter(transport);
  clearWarehouseCompanyCache();
  try {
    await purchaseAdapter.syncReceipt(tenant.id, receipt.id, correlationId);
    console.error("FAIL: PurchaseAdapter allowed cross-tenant warehouse!");
  } catch (err: any) {
    console.log("PASS: PurchaseAdapter correctly blocked:", err.message);
  }

  // Adapter 5: Transfer
  console.log("\n[5/5] Testing ErpTransferAdapter...");
  const transfer = await db.stockTransfer.create({
    data: {
      tenantId: tenant.id,
      fromStoreId: validStore.id,
      toStoreId: crossStore.id,
      status: "IN_TRANSIT",
      createdByUserId: user!.id,
      idempotencyKey: `trf-${Date.now()}`,
      lines: {
        create: [{ variantId: variant!.id, quantity: 1 }],
      },
    },
  });
  const transferAdapter = new ErpTransferAdapter(transport);
  clearWarehouseCompanyCache();
  try {
    await transferAdapter.syncSent(tenant.id, transfer.id, correlationId);
    console.error("FAIL: TransferAdapter allowed cross-tenant destination warehouse!");
  } catch (err: any) {
    console.log("PASS: TransferAdapter correctly blocked:", err.message);
  }

  // Clean up
  console.log("\nCleaning up test artifacts...");
  await db.stockTransferLine.deleteMany({ where: { transferId: transfer.id } });
  await db.stockTransfer.delete({ where: { id: transfer.id } });
  await db.purchaseReceiptLine.deleteMany({ where: { receiptId: receipt.id } });
  await db.purchaseReceipt.delete({ where: { id: receipt.id } });
  await db.saleReturnPayment.deleteMany({ where: { saleReturnId: saleReturn.id } });
  await db.saleReturnItem.deleteMany({ where: { saleReturnId: saleReturn.id } });
  await db.saleReturn.delete({ where: { id: saleReturn.id } });
  await db.salePayment.deleteMany({ where: { saleId: sale.id } });
  await db.saleItem.deleteMany({ where: { saleId: sale.id } });
  await db.sale.delete({ where: { id: sale.id } });
  await db.stockMovement.delete({ where: { id: movement.id } });

  // Clean up previous runs' dangling test records if any
  const tcStores = await db.store.findMany({
    where: { tenantId: tenant.id, code: { startsWith: "TC_" } },
    select: { id: true },
  });
  const tcIds = tcStores.map(s => s.id);
  if (tcIds.length > 0) {
    // Delete sales returns first so sales can be deleted
    await db.saleReturnPayment.deleteMany({ where: { saleReturn: { storeId: { in: tcIds } } } });
    await db.saleReturnItem.deleteMany({ where: { saleReturn: { storeId: { in: tcIds } } } });
    await db.saleReturn.deleteMany({ where: { storeId: { in: tcIds } } });

    await db.salePayment.deleteMany({ where: { sale: { storeId: { in: tcIds } } } });
    await db.saleItem.deleteMany({ where: { sale: { storeId: { in: tcIds } } } });
    await db.sale.deleteMany({ where: { storeId: { in: tcIds } } });

    await db.purchaseReceiptLine.deleteMany({ where: { receipt: { storeId: { in: tcIds } } } });
    await db.purchaseReceipt.deleteMany({ where: { storeId: { in: tcIds } } });

    await db.stockMovement.deleteMany({ where: { storeId: { in: tcIds } } });
    await db.stockTransferLine.deleteMany({ where: { transfer: { OR: [{ fromStoreId: { in: tcIds } }, { toStoreId: { in: tcIds } }] } } });
    await db.stockTransfer.deleteMany({ where: { OR: [{ fromStoreId: { in: tcIds } }, { toStoreId: { in: tcIds } }] } });
    await db.store.deleteMany({ where: { id: { in: tcIds } } });
  }
  console.log("Cleanup complete.");

  await db.$disconnect();
}

runAudit().catch(console.error);
