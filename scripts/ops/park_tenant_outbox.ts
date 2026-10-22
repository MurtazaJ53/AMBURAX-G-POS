import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute') && !args.includes('--unpark');
  const isUnpark = args.includes('--unpark');

  console.log('================================================================================');
  console.log(`   SHREE KRISHNA OUTBOX PARK / UNPARK TOOL [Mode: ${isUnpark ? 'UNPARK' : (dryRun ? 'DRY-RUN' : 'EXECUTE')}]`);
  console.log('   Working Directory: D:\\amburax-projects\\G-POS\\apps\\web');
  console.log('================================================================================\n');

  const skTenant = await prisma.tenant.findFirst({
    where: { name: { contains: 'Krishna', mode: 'insensitive' } },
  });

  if (!skTenant) throw new Error('Shree Krishna Fashion tenant not found');

  if (isUnpark) {
    // Only unpark events that were parked with our specific marker!
    const parkedCount: any = await prisma.$queryRawUnsafe(`
      SELECT count(*)::int as cnt
      FROM outbox_events
      WHERE "tenantId" = '${skTenant.id}' AND "lastError" = 'PARKED_PENDING_ERP_FISCAL_YEAR';
    `);
    console.log(`Parked events eligible for UNPARK: ${parkedCount[0].cnt}`);

    if (dryRun) {
      console.log('DRY-RUN: No changes made. Pass --unpark to reset them.');
      return;
    }

    const resetResult = await prisma.$executeRawUnsafe(`
      UPDATE outbox_events
      SET "deadLetteredAt" = NULL, "attempts" = 0, "lastError" = NULL
      WHERE "tenantId" = '${skTenant.id}' AND "lastError" = 'PARKED_PENDING_ERP_FISCAL_YEAR';
    `);
    console.log(`Successfully unparked ${resetResult} events for Shree Krishna Fashion.`);
    return;
  }

  // Parking logic
  const pendingCount: any = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int as cnt
    FROM outbox_events
    WHERE "tenantId" = '${skTenant.id}' AND "publishedAt" IS NULL AND "deadLetteredAt" IS NULL;
  `);

  console.log(`Pending unpublished events in Shree Krishna Fashion: ${pendingCount[0].cnt}`);

  if (dryRun) {
    console.log('\nDRY-RUN: Zero records touched. Run with --execute to park these events safely.');
    return;
  }

  const parkedResult = await prisma.$executeRawUnsafe(`
    UPDATE outbox_events
    SET "deadLetteredAt" = NOW(),
        "lastError" = 'PARKED_PENDING_ERP_FISCAL_YEAR'
    WHERE "tenantId" = '${skTenant.id}' 
      AND "publishedAt" IS NULL 
      AND "deadLetteredAt" IS NULL;
  `);

  console.log(`\nSuccessfully parked ${parkedResult} events with lastError='PARKED_PENDING_ERP_FISCAL_YEAR'.`);
  console.log('Zero events were deleted. You can reverse this anytime with --unpark.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
