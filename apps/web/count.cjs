const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
async function count() {
  console.log('Products:', await db.product.count());
  console.log('Variants:', await db.productVariant.count());
  console.log('Categories:', (await db.product.findMany({ select: { category: true }, distinct: ['category'] })).length);
  console.log('Brands:', (await db.product.findMany({ select: { brand: true }, distinct: ['brand'] })).length);
  console.log('With Image:', await db.product.count({ where: { imageUrl: { not: null } } }));
  console.log('Pricing:', await db.productVariant.count());
  console.log('StockLevel:', await db.stockLevel.count());
}
count();
