import type { Prisma, PrismaClient } from "@prisma/client";
import { nextTenantBarcode } from "@/server/catalog/barcodeGenerator";
import { syncVariantBarcode } from "@/server/catalog/variantDualWrite";

/**
 * Gives every active, non-draft variant that has no barcode the tenant's next in-store code.
 *
 * What it writes: `product_variants.barcode` and the primary `variant_barcodes` row, nothing
 * else. It enqueues no outbox event and leaves `erpSyncStatus` alone. ERPNext is only ever
 * told about catalogue changes through outbox events (see server/erp/outboxPublisher), and
 * barcodes are not part of the ERPNext item payload, so a backfill of any size sends nothing
 * to ERPNext.
 *
 * Idempotent: a variant is only written while its barcode is still empty, so a second run, or
 * a run racing a person who just typed a barcode in, changes nothing that already has one.
 */

const MISSING_BARCODE = {
  isActive: true,
  product: { isDraft: false },
  OR: [{ barcode: null }, { barcode: "" }],
} satisfies Prisma.ProductVariantWhereInput;

export type BackfillClient = Pick<PrismaClient, "$transaction" | "productVariant">;

export async function countMissingBarcodes(
  client: Pick<PrismaClient, "productVariant">,
  tenantId?: string,
): Promise<Array<{ tenantId: string; missing: number }>> {
  const groups = await client.productVariant.groupBy({
    by: ["tenantId"],
    where: { ...MISSING_BARCODE, ...(tenantId ? { tenantId } : {}) },
    _count: { _all: true },
    orderBy: { tenantId: "asc" },
  });
  return groups.map((g) => ({ tenantId: g.tenantId, missing: g._count._all }));
}

export async function backfillTenantBarcodes(
  client: BackfillClient,
  tenantId: string,
  options: { batchSize?: number; onBatch?: (assignedSoFar: number) => void } = {},
): Promise<{ assigned: number; batches: number }> {
  const batchSize = options.batchSize ?? 500;
  let assigned = 0;
  let batches = 0;

  for (;;) {
    const batch = await client.productVariant.findMany({
      where: { ...MISSING_BARCODE, tenantId },
      select: { id: true },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (batch.length === 0) break;

    // One transaction per batch: the sequence row stays locked for the batch, so concurrent
    // creates for this tenant wait a moment rather than interleave numbers.
    const assignedInBatch = await client.$transaction(
      async (tx) => {
        let count = 0;
        for (const { id } of batch) {
          const code = await nextTenantBarcode(tx, tenantId);
          const written = await tx.productVariant.updateMany({
            where: { id, tenantId, OR: [{ barcode: null }, { barcode: "" }] },
            data: { barcode: code },
          });
          if (written.count === 1) {
            await syncVariantBarcode(tx, { tenantId, variantId: id, barcode: code, type: "INTERNAL" });
            count++;
          }
        }
        return count;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );

    assigned += assignedInBatch;
    batches++;
    options.onBatch?.(assigned);
    // Nothing in a full batch could be written: something else holds these rows. Stop rather
    // than spin on the same ids.
    if (assignedInBatch === 0) break;
  }

  return { assigned, batches };
}
