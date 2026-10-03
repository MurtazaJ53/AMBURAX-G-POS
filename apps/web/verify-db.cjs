const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  
  // 1. Fetch latest sale
  const sale = await prisma.sale.findFirst({
    orderBy: { createdAt: 'desc' },
    include: {
      items: {
        include: { variant: { include: { product: true } } }
      },
      payments: true,
      store: true,
      customer: true
    }
  });

  if (!sale) {
    console.log("No sale found!");
    process.exit(1);
  }

  console.log("=== REAL TRANSACTION VERIFICATION ===");
  console.log(`Sale ID: ${sale.id}`);
  console.log(`Tenant ID: ${sale.tenantId}`);
  console.log(`Store: ${sale.store?.name} (${sale.storeId})`);
  console.log(`Customer: ${sale.customer ? sale.customer.name : 'Walk-in'} (${sale.customerId || 'none'})`);
  console.log(`Items: ${sale.items.length}`);
  sale.items.forEach(item => {
    console.log(`  - ${item.variant.product.name} (Qty: ${item.quantity})`);
  });
  console.log(`Payments: ${sale.payments.length}`);
  sale.payments.forEach(payment => {
    console.log(`  - ${payment.method}: ${payment.amount}`);
  });

  // 2. Fetch inventory ledger entries for these variants
  const variantIds = sale.items.map(i => i.productVariantId);
  const ledgers = await prisma.inventoryLedger.findMany({
    where: {
      productVariantId: { in: variantIds },
      storeId: sale.storeId,
      type: 'SALE'
    },
    orderBy: { createdAt: 'desc' },
    take: variantIds.length
  });

  console.log(`Inventory Decrements (Ledger Entries): ${ledgers.length}`);
  ledgers.forEach(l => {
    console.log(`  - Variant ${l.productVariantId}: ${l.quantity} (Type: ${l.type})`);
  });

  await prisma.$disconnect();
})();
