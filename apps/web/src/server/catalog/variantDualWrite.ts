import type { Prisma } from "@prisma/client";

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

/**
 * Robust primary barcode synchronization:
 * - Demotes or deletes old primary barcode before setting new one (prevents one_primary index violation)
 * - Detects barcode collision across variants and throws DuplicateBarcodeError
 * - Cleans up internal barcode when user clears the barcode string
 */
export function inferBarcodeType(barcode: string): "INTERNAL" | "MANUFACTURER" | "EAN13" {
  const clean = barcode.trim();
  if (/^\d{13}$/.test(clean)) {
    return "EAN13";
  }
  // Check if it's an internal short code (e.g. 20xxxxxx or BC-...)
  if (/^2\d{7,8}$/.test(clean) || clean.startsWith("BC-") || clean.startsWith("INT-")) {
    return "INTERNAL";
  }
  return "MANUFACTURER";
}

export async function syncVariantBarcode(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    variantId: string;
    barcode?: string | null;
    type?: "INTERNAL" | "MANUFACTURER" | "EAN13";
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
    barcodeType?: "INTERNAL" | "MANUFACTURER" | "EAN13";
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
