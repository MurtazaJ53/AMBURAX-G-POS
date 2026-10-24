import type { Prisma } from "@prisma/client";
import { gtinCheckDigit } from "@/lib/gtin";

/**
 * In-store barcodes: EAN-13 in the GS1 restricted-circulation range, "21" + a 10-digit number
 * + check digit, numbered in sequence per tenant. Ten billion codes per shop, no randomness,
 * and a format every retail scanner reads.
 *
 * The number comes from `tenant_barcode_sequences`, incremented with an upsert inside the
 * caller's transaction. The row lock that upsert takes is held until the transaction ends, so
 * two concurrent creates for one tenant queue behind each other and never draw the same number.
 * A number a supplier code or an older row already uses is skipped, not reused.
 *
 * This module takes the transaction client from its caller and imports no database handle of
 * its own: a barcode must be drawn in the same transaction that writes the variant.
 */

export const INTERNAL_BARCODE_PREFIX = "21";
const SEQUENCE_DIGITS = 10;
const MAX_SEQUENCE = 10 ** SEQUENCE_DIGITS - 1;
/** Consecutive taken numbers tolerated before giving up; only legacy data can cause any. */
const MAX_SKIPS = 1000;

export function buildInternalBarcode(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) {
    throw new Error(`Barcode sequence out of range: ${sequence}`);
  }
  const payload = `${INTERNAL_BARCODE_PREFIX}${String(sequence).padStart(SEQUENCE_DIGITS, "0")}`;
  return `${payload}${gtinCheckDigit(payload)}`;
}

type BarcodeTx = Pick<Prisma.TransactionClient, "$queryRaw" | "variantBarcode" | "productVariant">;

async function nextSequence(tx: BarcodeTx, tenantId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ lastValue: bigint }[]>`
    INSERT INTO "tenant_barcode_sequences" ("tenantId", "lastValue", "updatedAt")
    VALUES (${tenantId}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("tenantId") DO UPDATE
      SET "lastValue" = "tenant_barcode_sequences"."lastValue" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "lastValue"
  `;
  return Number(rows[0]!.lastValue);
}

async function isBarcodeTaken(tx: BarcodeTx, tenantId: string, barcode: string): Promise<boolean> {
  const [inBarcodes, inVariants] = await Promise.all([
    tx.variantBarcode.findFirst({ where: { tenantId, barcode }, select: { id: true } }),
    tx.productVariant.findFirst({ where: { tenantId, barcode }, select: { id: true } }),
  ]);
  return Boolean(inBarcodes || inVariants);
}

/** The tenant's next free in-store barcode. Call inside the transaction that writes the variant. */
export async function nextTenantBarcode(tx: BarcodeTx, tenantId: string): Promise<string> {
  for (let attempt = 0; attempt <= MAX_SKIPS; attempt++) {
    const candidate = buildInternalBarcode(await nextSequence(tx, tenantId));
    if (!(await isBarcodeTaken(tx, tenantId, candidate))) return candidate;
  }
  throw new Error("BARCODE_SEQUENCE_BLOCKED");
}
