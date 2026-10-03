const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function run() {
  const multi = await prisma.sale.findFirst({
    where: { idempotencyKey: { startsWith: "split-exact" } },
    include: { payments: true, items: true }
  });
  if (multi) {
    console.log("Sale ID:", multi.id);
    console.log("Items:", multi.items.map(l => l.id).join(", "));
    console.log("Total Minor:", multi.totalMinor);
    console.log("Paid Minor:", multi.paidMinor);
    let sum = 0;
    for (const p of multi.payments) {
      console.log(` Payment method: ${p.method}, amount: ${p.amountMinor}, ref: ${p.reference}`);
      sum += p.amountMinor;
    }
    console.log("SUM(payments):", sum);
    
    // Check Stock movements
    const stock = await prisma.stockMovement.findMany({
      where: { reference: multi.id }
    });
    console.log("Stock Movements:", stock.map(s => s.id).join(", "));
  } else {
    console.log("No SPLIT sales found in DB.");
  }
}

run().catch(console.error).finally(() => prisma.$disconnect());
