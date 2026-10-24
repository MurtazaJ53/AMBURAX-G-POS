/**
 * Give every active, non-draft variant without a barcode its tenant's next in-store EAN-13.
 *
 * Dry run (default) only counts, per tenant. Nothing is written.
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/ops/backfill_variant_barcodes.ts
 *
 * Apply (needs migration 20261024090000_tenant_barcode_sequence):
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/ops/backfill_variant_barcodes.ts --apply [--tenant=<id>] [--batch=500]
 *
 * Writes product_variants.barcode and variant_barcodes only. No outbox events, so nothing is
 * sent to ERPNext (see apps/web/src/server/catalog/barcodeBackfill.ts). Safe to re-run.
 */
import { PrismaClient } from "@prisma/client";
import { backfillTenantBarcodes, countMissingBarcodes } from "../../apps/web/src/server/catalog/barcodeBackfill";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

async function main() {
  const apply = arg("apply") === "true";
  const tenantId = arg("tenant");
  const batchSize = Number(arg("batch") ?? 500);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
    throw new Error("--batch must be a whole number from 1 to 5000.");
  }

  const prisma = new PrismaClient();
  try {
    const counts = await countMissingBarcodes(prisma, tenantId);
    const total = counts.reduce((sum, c) => sum + c.missing, 0);
    console.log(apply ? "APPLY" : "DRY RUN (nothing written)");
    console.table(counts.map((c) => ({ tenant: c.tenantId, "variants without barcode": c.missing })));
    console.log(`Total: ${total}`);
    if (!apply || total === 0) return;

    for (const { tenantId: id, missing } of counts) {
      const started = Date.now();
      const result = await backfillTenantBarcodes(prisma, id, {
        batchSize,
        onBatch: (done) => console.log(`  ${id}: ${done}/${missing}`),
      });
      console.log(`${id}: assigned ${result.assigned} in ${result.batches} batches, ${Math.round((Date.now() - started) / 1000)}s`);
    }

    const left = await countMissingBarcodes(prisma, tenantId);
    console.log(`Still without barcode: ${left.reduce((sum, c) => sum + c.missing, 0)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
