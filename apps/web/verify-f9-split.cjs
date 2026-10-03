const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");

async function run() {
  // Get an active tenant and store
  const tenant = await prisma.tenant.findFirst();
  const store = await prisma.store.findFirst({ where: { tenantId: tenant.id } });
  const owner = await prisma.user.findFirst({ where: { memberships: { some: { tenantId: tenant.id, role: "OWNER" } } } });
  
  if (!tenant || !store || !owner) {
    console.log("Missing baseline data.");
    return;
  }

  // Find a product variant to sell
  const sl = await prisma.stockLevel.findFirst({ where: { storeId: store.id, quantity: { gt: 0 } } });
  if (!sl) {
    console.log("No stock level > 0 found.");
    return;
  }
  
  const variant = await prisma.productVariant.findUnique({ where: { id: sl.variantId }, include: { product: true } });
  // Price will be variant price
  const price = variant.priceMinor || 10000; 

  const idKey = `split-test-${crypto.randomUUID()}`;

  const payload = {
    tenantId: tenant.id,
    storeId: store.id,
    cashierUserId: owner.id,
    idempotencyKey: idKey,
    lines: [
      { variantId: variant.id, quantity: 1 }
    ],
    payments: [
      { method: "CASH", amountMinor: Math.floor(price / 2) },
      { method: "UPI", amountMinor: price - Math.floor(price / 2), reference: "ref123" }
    ],
    correlationId: "corr-f9-test",
  };

  console.log("1. Executing FIRST Split Sale...");
  // Import the sale service
  const saleService = require("./src/server/sales/saleService");
  
  const res1 = await saleService.createSale(payload);
  console.log("Result 1 Status:", res1.status);
  
  if (res1.status !== "ok") {
    console.log("Failed:", res1);
    return;
  }

  const sale1 = await prisma.sale.findUnique({
    where: { id: res1.sale.id },
    include: { payments: true, items: true }
  });
  
  const movements1 = await prisma.stockMovement.findMany({ where: { reference: sale1.id } });

  console.log("Sale ID:", sale1.id);
  console.log("SaleItems:", sale1.items.map(i => i.id));
  console.log("Payments:", sale1.payments.map(p => p.id));
  console.log("Payment Methods:", sale1.payments.map(p => p.method));
  console.log("Payment Amounts:", sale1.payments.map(p => p.amountMinor));
  console.log("StockMovements:", movements1.map(m => m.id));

  console.log(`\nDB VERIFY:`);
  console.log("Total Minor:", sale1.totalMinor);
  console.log("Paid Minor:", sale1.paidMinor);
  const sumPayments = sale1.payments.reduce((acc, p) => acc + p.amountMinor, 0);
  console.log("SUM(payments):", sumPayments);
  console.log("Row count:", sale1.payments.length);

  console.log("\n2. Executing SECOND Split Sale (IDEMPOTENCY TEST)...");
  const res2 = await saleService.createSale(payload);
  console.log("Result 2 Status:", res2.status);

  // Check counts
  const totalSales = await prisma.sale.count({ where: { idempotencyKey: idKey } });
  const totalItems = await prisma.saleItem.count({ where: { sale: { idempotencyKey: idKey } } });
  const totalPayments = await prisma.salePayment.count({ where: { sale: { idempotencyKey: idKey } } });
  const totalMovements = await prisma.stockMovement.count({ where: { reference: sale1.id } });

  console.log(`\nIDEMPOTENCY VERIFY:`);
  console.log("Total Sales matching key:", totalSales);
  console.log("Total SaleItems matching key:", totalItems);
  console.log("Total SalePayments matching key:", totalPayments);
  console.log("Total StockMovements matching sale ID:", totalMovements);
  
}
run().catch(console.error).finally(() => prisma.$disconnect());
