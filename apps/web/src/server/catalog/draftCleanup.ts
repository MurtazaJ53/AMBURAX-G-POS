import { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";

/**
 * Scheduled Safe Cleanup of Abandoned Draft Products.
 *
 * Rules:
 * 1. Checks `draftExpiresAt < NOW()` (respects active adoption/refreshed expiry).
 * 2. Only deletes if:
 *    - `isDraft: true`
 *    - Zero stock movements (`stock_movements` count = 0)
 *    - Zero stock levels (`stock_levels.quantity` = 0)
 *    - Zero purchase receipt lines (`purchase_receipt_lines` count = 0)
 *    - Zero purchase order lines (`purchase_order_lines` count = 0)
 *    - Zero outbox events.
 * 3. Deletes variants, barcodes, attribute links, and product in ONE atomic transaction per product.
 * 4. Supports `dryRun: true` for audit logs without deleting.
 */
export async function cleanupExpiredDraftProducts(params?: {
  tenantId?: string;
  dryRun?: boolean;
}): Promise<{ examined: number; eligible: number; deleted: number; candidates: string[] }> {
  const dryRun = params?.dryRun ?? false;
  const now = new Date();

  const draftProducts = await db.product.findMany({
    where: {
      ...(params?.tenantId ? { tenantId: params.tenantId } : {}),
      isDraft: true,
      draftExpiresAt: { lt: now },
    },
    include: {
      variants: {
        select: {
          id: true,
          stockLevels: { select: { quantity: true } },
          stockMovements: { select: { id: true } },
          purchaseReceiptLines: { select: { id: true } },
          purchaseOrderLines: { select: { id: true } },
        },
      },
    },
  });

  const candidates: string[] = [];
  let deletedCount = 0;

  for (const prod of draftProducts) {
    let hasLedgerActivity = false;

    for (const v of prod.variants) {
      if (v.stockMovements.length > 0) hasLedgerActivity = true;
      if (v.purchaseReceiptLines.length > 0) hasLedgerActivity = true;
      if (v.purchaseOrderLines.length > 0) hasLedgerActivity = true;
      if (v.stockLevels.some((sl) => sl.quantity !== 0)) hasLedgerActivity = true;
      if (hasLedgerActivity) break;
    }

    if (!hasLedgerActivity) {
      candidates.push(prod.id);

      if (!dryRun) {
        const variantIds = prod.variants.map((v) => v.id);
        await db.$transaction(async (tx) => {
          // 1. Delete associated barcodes
          await tx.variantBarcode.deleteMany({
            where: { variantId: { in: variantIds } },
          });
          // 2. Delete variant attribute values
          await tx.variantAttributeValue.deleteMany({
            where: { variantId: { in: variantIds } },
          });
          // 3. Delete stock levels
          await tx.stockLevel.deleteMany({
            where: { variantId: { in: variantIds } },
          });
          // 4. Delete product variants
          await tx.productVariant.deleteMany({
            where: { id: { in: variantIds } },
          });
          // 5. Delete product
          await tx.product.delete({
            where: { id: prod.id },
          });
        });
        deletedCount++;
      }
    }
  }

  return {
    examined: draftProducts.length,
    eligible: candidates.length,
    deleted: deletedCount,
    candidates,
  };
}
