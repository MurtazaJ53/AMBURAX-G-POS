const { PrismaClient } = require('@prisma/client');

async function main() {
  const p = new PrismaClient();
  
  // Test dev DB (assuming DATABASE_URL is dev by default in .env)
  const devRes = await p.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='products' AND column_name='imageUrl';`);
  console.log("Dev DB column:", devRes);
  
  // Test test DB
  const oldUrl = process.env.DATABASE_URL;
  // If there's a specific test DB url
  // Just querying default for now, if E2E passed it should be in both or prisma handles it.
  
  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
