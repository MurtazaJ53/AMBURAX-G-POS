const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function run() {
  const sale = await prisma.sale.findFirst({
    where: { idempotencyKey: { startsWith: "split-exact" } },
    include: { payments: true, items: true }
  });
  if (sale) {
    const movements = await prisma.stockMovement.findMany({ where: { reference: sale.id } });
    console.log("============= DB EVIDENCE =============");
    console.log("Sale ID:", sale.id);
    console.log("SaleItems:", sale.items.map(i => i.id));
    console.log("Payments:", sale.payments.map(p => p.id));
    console.log("Payment Methods:", sale.payments.map(p => p.method));
    console.log("Payment Amounts:", sale.payments.map(p => p.amountMinor));
    console.log("StockMovements:", movements.map(m => m.id));
    console.log("Total Minor:", sale.totalMinor);
    console.log("Paid Minor:", sale.paidMinor);
    const sumPayments = sale.payments.reduce((acc, p) => acc + p.amountMinor, 0);
    console.log("SUM(payments):", sumPayments);
    console.log("Row count:", sale.payments.length);
    console.log("Tenant ID:", sale.tenantId);
    console.log("Store ID:", sale.storeId);
    
    // Idempotency counts
    const totalSales = await prisma.sale.count({ where: { idempotencyKey: sale.idempotencyKey } });
    const totalItems = await prisma.saleItem.count({ where: { sale: { idempotencyKey: sale.idempotencyKey } } });
    const totalPayments = await prisma.salePayment.count({ where: { sale: { idempotencyKey: sale.idempotencyKey } } });
    console.log("\n============= IDEMPOTENCY VERIFY =============");
    console.log("Total Sales matching key:", totalSales);
    console.log("Total SaleItems matching key:", totalItems);
    console.log("Total SalePayments matching key:", totalPayments);
  } else {
    console.log("No split sale found yet. Wait for integration tests to hit it.");
  }
}
run().finally(() => prisma.$disconnect());
