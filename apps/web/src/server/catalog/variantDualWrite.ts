import type { Prisma } from "@prisma/client";
import { isValidGtin } from "@/lib/gtin";

export class DuplicateBarcodeError extends Error {
  constructor(public readonly barcode: string) {
    super(`Barcode "${barcode}" is already assigned to another variant.`);
    this.name = "DuplicateBarcodeError";
  }
}

export function normalizeMasterCode(val: string): string | null {
  if (!val) return null;
  const cleaned = val.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned === "" ? null : cleaned;
}

/**
 * Ensures system attribute definitions (SIZE and COLOUR) exist for a tenant.
 */
export async function ensureSystemAttributeDefinitions(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<{ sizeDefId: string; colourDefId: string }> {
  const sizeDef = await tx.attributeDefinition.upsert({
    where: { tenantId_code: { tenantId, code: "SIZE" } },
    update: {},
    create: {
      tenantId,
      name: "Size",
      code: "SIZE",
      sortOrder: 1,
      isSystem: true,
      isMandatory: false,
    },
    select: { id: true },
  });

  const colourDef = await tx.attributeDefinition.upsert({
    where: { tenantId_code: { tenantId, code: "COLOUR" } },
    update: {},
    create: {
      tenantId,
      name: "Colour",
      code: "COLOUR",
      sortOrder: 2,
      isSystem: true,
      isMandatory: false,
    },
    select: { id: true },
  });

  return { sizeDefId: sizeDef.id, colourDefId: colourDef.id };
}

/**
 * Ensures an attribute value exists for a definition and returns its id.
 * Handles concurrency race conditions by catching P2002 and retrying lookup.
 */
export async function ensureAttributeValue(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    definitionId: string;
    value: string;
    colorHex?: string | null;
  }
): Promise<string | null> {
  const code = normalizeMasterCode(params.value);
  if (!code) return null;

  try {
    const attrVal = await tx.attributeValue.upsert({
      where: {
        tenantId_definitionId_code: {
          tenantId: params.tenantId,
          definitionId: params.definitionId,
          code,
        },
      },
      update: params.colorHex ? { colorHex: params.colorHex } : {},
      create: {
        tenantId: params.tenantId,
        definitionId: params.definitionId,
        value: params.value.trim(),
        code,
        colorHex: params.colorHex ?? null,
        sortOrder: 0,
        isActive: true,
      },
      select: { id: true },
    });
    return attrVal.id;
  } catch (err: unknown) {
    // If a concurrent request created the same code in parallel, retry lookup
    const existing = await tx.attributeValue.findUnique({
      where: {
        tenantId_definitionId_code: {
          tenantId: params.tenantId,
          definitionId: params.definitionId,
          code,
        },
      },
      select: { id: true },
    });
    if (existing) return existing.id;
    throw err;
  }
}

export type VariantBarcodeKind = "INTERNAL" | "MANUFACTURER" | "EAN13" | "EAN8" | "UPC";

/**
 * What kind of code a typed or scanned barcode is. Codes are stored exactly as entered; this
 * only labels them.
 *
 * GS1 reserves prefix 2 for in-store numbers (RCN-8 and RCN-13), so 8- and 13-digit codes
 * starting with 2 are this shop's own, as are the older BC-/INT- codes. Other codes are
 * recognised by length and check digit: EAN-8, UPC-A, EAN-13. Anything else is a supplier
 * code in some other format.
 */
export function inferBarcodeType(barcode: string): VariantBarcodeKind {
  const clean = barcode.trim();
  if (/^2(\d{7}|\d{8}|\d{12})$/.test(clean) || clean.startsWith("BC-") || clean.startsWith("INT-")) {
    return "INTERNAL";
  }
  if (isValidGtin(clean, 13)) return "EAN13";
  if (isValidGtin(clean, 12)) return "UPC";
  if (isValidGtin(clean, 8)) return "EAN8";
  return "MANUFACTURER";
}

function uniqueViolationTarget(err: unknown): string | null {
  const e = err as { code?: string; meta?: { target?: unknown } } | null;
  if (e?.code !== "P2002") return null;
  const target = e.meta?.target;
  return Array.isArray(target) ? target.join(",") : String(target ?? "");
}

/**
 * Whether an error is a barcode collision: our own DuplicateBarcodeError, or PostgreSQL's
 * unique violation (Prisma P2002) on a `barcode` column, which a concurrent create can raise
 * after the pre-checks passed.
 */
export function isDuplicateBarcodeError(err: unknown): boolean {
  if (err instanceof DuplicateBarcodeError) return true;
  const target = uniqueViolationTarget(err);
  return target !== null && /barcode/i.test(target);
}

/** Same as isDuplicateBarcodeError, for the `sku` column. */
export function isDuplicateSkuError(err: unknown): boolean {
  const target = uniqueViolationTarget(err);
  return target !== null && /(^|[,_])sku($|[,_])/i.test(target);
}

/**
 * Robust primary barcode synchronization:
 * - Demotes or deletes old primary barcode before setting new one (prevents one_primary index violation)
 * - Detects barcode collision across variants and throws DuplicateBarcodeError
 * - Cleans up internal barcode when user clears the barcode string
 */
export async function syncVariantBarcode(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    variantId: string;
    barcode?: string | null;
    type?: VariantBarcodeKind;
  }
): Promise<void> {
  const { tenantId, variantId } = params;
  const clean = params.barcode?.trim() || null;

  const current = await tx.variantBarcode.findFirst({
    where: { tenantId, variantId, isPrimary: true },
  });

  // 1. Barcode was cleared
  if (!clean) {
    if (current) {
      if (current.type === "INTERNAL") {
        await tx.variantBarcode.delete({ where: { id: current.id } });
      } else {
        await tx.variantBarcode.update({
          where: { id: current.id },
          data: { isPrimary: false },
        });
      }
    }
    return;
  }

  // 2. Barcode is unchanged
  if (current?.barcode === clean) {
    return;
  }

  // 3. Check for conflict on clean barcode
  const existing = await tx.variantBarcode.findUnique({
    where: { tenantId_barcode: { tenantId, barcode: clean } },
  });

  if (existing && existing.variantId !== variantId) {
    throw new DuplicateBarcodeError(clean);
  }

  // 4. Demote or remove old primary first so partial index is satisfied
  if (current) {
    if (current.type === "INTERNAL") {
      await tx.variantBarcode.delete({ where: { id: current.id } });
    } else {
      await tx.variantBarcode.update({
        where: { id: current.id },
        data: { isPrimary: false },
      });
    }
  }

  const barcodeType = params.type || inferBarcodeType(clean);

  // 5. Assign new primary barcode
  if (existing) {
    await tx.variantBarcode.update({
      where: { id: existing.id },
      data: { isPrimary: true, type: barcodeType },
    });
  } else {
    try {
      await tx.variantBarcode.create({
        data: {
          tenantId,
          variantId,
          barcode: clean,
          type: barcodeType,
          isPrimary: true,
        },
      });
    } catch (err: unknown) {
      const pErr = err as { code?: string };
      if (pErr?.code === "P2002") {
        throw new DuplicateBarcodeError(clean);
      }
      throw err;
    }
  }
}

/**
 * Synchronizes dual-write relational records for a ProductVariant:
 * 1. Links or unlinks Variant to Size & Colour in `variant_attribute_values`
 * 2. Manages primary barcode in `variant_barcodes` safely
 */
export async function syncVariantDualWrite(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    variantId: string;
    size?: string | null;
    colour?: string | null;
    barcode?: string | null;
    barcodeType?: VariantBarcodeKind;
    definitions?: { sizeDefId: string; colourDefId: string };
  }
): Promise<void> {
  const { tenantId, variantId, size, colour, barcode, barcodeType } = params;

  // Resolve definitions once (or reuse passed definitions for bulk speed)
  const defs =
    params.definitions || (await ensureSystemAttributeDefinitions(tx, tenantId));

  // --- 1. Size Link / Unlink ---
  const cleanSize = size?.trim() || null;
  if (cleanSize) {
    const sizeValId = await ensureAttributeValue(tx, {
      tenantId,
      definitionId: defs.sizeDefId,
      value: cleanSize,
    });

    if (sizeValId) {
      await tx.variantAttributeValue.upsert({
        where: {
          variantId_attributeDefinitionId: {
            variantId,
            attributeDefinitionId: defs.sizeDefId,
          },
        },
        update: { attributeValueId: sizeValId },
        create: {
          tenantId,
          variantId,
          attributeDefinitionId: defs.sizeDefId,
          attributeValueId: sizeValId,
        },
      });
    }
  } else {
    // If size cleared, delete existing link so reports & filters stay clean
    await tx.variantAttributeValue.deleteMany({
      where: {
        variantId,
        attributeDefinitionId: defs.sizeDefId,
      },
    });
  }

  // --- 2. Colour Link / Unlink ---
  const cleanColour = colour?.trim() || null;
  if (cleanColour) {
    const colourValId = await ensureAttributeValue(tx, {
      tenantId,
      definitionId: defs.colourDefId,
      value: cleanColour,
    });

    if (colourValId) {
      await tx.variantAttributeValue.upsert({
        where: {
          variantId_attributeDefinitionId: {
            variantId,
            attributeDefinitionId: defs.colourDefId,
          },
        },
        update: { attributeValueId: colourValId },
        create: {
          tenantId,
          variantId,
          attributeDefinitionId: defs.colourDefId,
          attributeValueId: colourValId,
        },
      });
    }
  } else {
    // If colour cleared, delete existing link
    await tx.variantAttributeValue.deleteMany({
      where: {
        variantId,
        attributeDefinitionId: defs.colourDefId,
      },
    });
  }

  // --- 3. Barcode Safe Sync ---
  await syncVariantBarcode(tx, {
    tenantId,
    variantId,
    barcode,
    type: barcodeType,
  });
}
