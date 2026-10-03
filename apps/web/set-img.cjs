const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
    await prisma.product.updateMany({ 
        where: { name: 'Casual Crossbody Bag' }, 
        data: { imageUrl: '/images/products/casual-crossbody-bag.jpg' } 
    });
    console.log("Updated!");
    await prisma.$disconnect();
})();
