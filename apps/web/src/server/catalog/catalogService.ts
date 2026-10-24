import { cancelPendingPriceChanges } from "@/server/inventory/priceChanges";
import { GstTaxTreatment, Prisma, TenantRole, type TaxRateMode } from "@prisma/client";
import { getApparelSlab } from "@/server/tax/taxSettings";
import { apparelSlabRateBp } from "@/server/sales/saleTotals";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { canManageCatalog } from "@/server/catalog/catalogRoles";
import { gstClassificationError } from "@/server/catalog/gstTaxTreatment";
import { nextTenantBarcode } from "@/server/catalog/barcodeGenerator";
import { applyStockMovement } from "@/server/inventory/stockLedger";
import {
  syncVariantDualWrite,
  DuplicateBarcodeError,
  isDuplicateBarcodeError,
  isDuplicateSkuError,
} from "@/server/catalog/variantDualWrite";
import { randomUUID } from "node:crypto";


/**
 * Attach the rate mode to a classification. A garment-slab variant must be TAXABLE, and its
 * stored rate is the slab rate at its list price — the rate that applies when it sells with
 * no discount — so ERP, reports and anything reading taxRateBp see a true figure. The till
 * re-picks the rate from the discounted price at sale time.
 */
export async function withRateMode(
  tenantId: string,
  base: { taxRateBp: number; taxTreatment: GstTaxTreatment; taxExemptionRef: string | null },
  taxRateMode: TaxRateMode,
  priceMinor: number,
): Promise<{ taxRateBp: number; taxTreatment: GstTaxTreatment; taxExemptionRef: string | null; taxRateMode: TaxRateMode }> {
  if (taxRateMode !== "APPAREL_SLAB") return { ...base, taxRateMode: "FIXED" };
  if (base.taxTreatment !== GstTaxTreatment.TAXABLE) {
    // Leaves a classification gstClassificationError will refuse: a slab only applies to taxable goods.
    return { ...base, taxRateBp: -1, taxRateMode };
  }
  const slab = await getApparelSlab(tenantId);
  return { ...base, taxRateBp: apparelSlabRateBp(priceMinor, 1, slab), taxRateMode };
}
export interface CatalogActor {
  tenantId: string;
  userId: string;
  tenantRole: TenantRole;
}

export type CatalogFailure = "forbidden" | "not_found" | "conflict";
export type CatalogError =
  | CatalogFailure
  | "duplicate_barcode"
  | "duplicate_sku"
  | "duplicate_product_name"
  | "price_exceeds_mrp"
  | "price_below_minimum"
  | "invalid_store"
  | "invalid_tax_classification";

export interface DuplicateProductConflict {
  id: string;
  name: string;
  brand: string | null;
  isActive: boolean;
  stockCount: number;
}

export interface CreateVariantItemInput {
  sku: string;
  barcode: string | null;
  barcodeType?: "INTERNAL" | "MANUFACTURER" | "EAN13";
  size: string | null;
  colour: string | null;
  costPriceMinor?: number | null;
  priceMinor: number;
  mrpMinor: number | null;
  minPriceMinor?: number | null;
  taxRateBp?: number;
  taxTreatment?: GstTaxTreatment;
  taxExemptionRef?: string | null;
  taxRateMode?: TaxRateMode;
  isActive: boolean;
  openingQty?: number | null;
  openingStock?: Array<{ storeId: string; quantity: number }>;
  isFreeSample?: boolean;
}

export interface CreateProductInput {
  actor: CatalogActor;
  storeId?: string;
  name: string;
  category: string | null;
  brand: string | null;
  imageUrl?: string | null;
  hsnCode?: string | null;
  isActive: boolean;
  isDraft?: boolean;
  draftExpiresAt?: Date | null;
  baseUomId: string;
  correlationId: string;
  firstVariant?: CreateVariantItemInput;
  variants?: CreateVariantItemInput[];
}

export type CreateProductResult = 
  | { status: "ok"; productId: string; variantId: string; variants: Array<{ id: string; sku: string; barcode: string | null }> }
  | { status: "duplicate_product_name" }
  | { status: "invalid_tax_classification" }
  | { status: "duplicate_barcode"; barcode: string }
  | { status: "duplicate_sku"; sku: string }
  | { status: "price_exceeds_mrp"; message: string }
  | { status: "price_below_minimum"; message: string }
  | { status: "invalid_store"; message: string }
  | { status: "validation_error"; message: string }
  | { status: CatalogFailure };

export async function createProduct(input: CreateProductInput): Promise<CreateProductResult> {
  if (!canManageCatalog(input.actor.tenantRole)) {
    return { status: "forbidden" };
  }

  const rawVariants = (input.variants && input.variants.length > 0)
    ? input.variants
    : input.firstVariant
      ? [input.firstVariant]
      : [];

  if (rawVariants.length === 0) {
    return { status: "not_found" };
  }

  const tenant = await db.tenant.findUnique({
    where: { id: input.actor.tenantId },
    select: { taxId: true },
  });
  const isGstShop = Boolean(tenant?.taxId?.trim());

  // Pre-validate unique SKUs, Barcodes and Tax Classification before opening a transaction
  const seenSkus = new Set<string>();
  const seenBarcodes = new Set<string>();

  for (const v of rawVariants) {
    if (v.sku?.trim()) {
      const normalizedSku = v.sku.trim().toUpperCase();
      if (seenSkus.has(normalizedSku)) {
        return { status: "duplicate_sku", sku: v.sku.trim() };
      }
      seenSkus.add(normalizedSku);

      const existingSku = await db.productVariant.findFirst({
        where: { sku: v.sku.trim(), tenantId: input.actor.tenantId },
        select: { id: true },
      });
      if (existingSku) return { status: "duplicate_sku", sku: v.sku.trim() };
    }

    if (v.barcode?.trim()) {
      const bc = v.barcode.trim();
      if (seenBarcodes.has(bc)) {
        return { status: "duplicate_barcode", barcode: bc };
      }
      seenBarcodes.add(bc);

      const existingBarcode = await db.variantBarcode.findFirst({
        where: { barcode: bc, tenantId: input.actor.tenantId },
        select: { id: true },
      });
      if (existingBarcode) return { status: "duplicate_barcode", barcode: bc };
    }

    if (!v.taxTreatment || v.taxTreatment === GstTaxTreatment.UNSPECIFIED) {
      return { status: "invalid_tax_classification" };
    }

    // For non-GST shops (no taxId), reject TAXABLE or positive tax rate. Allow NON_GST and EXEMPT (taxRateBp = 0).
    if (!isGstShop && (v.taxTreatment === GstTaxTreatment.TAXABLE || (v.taxRateBp && v.taxRateBp > 0))) {
      return { status: "invalid_tax_classification" };
    }

    const checkTaxClassification = await withRateMode(
      input.actor.tenantId,
      {
        taxRateBp: v.taxRateBp ?? 0,
        taxTreatment: v.taxTreatment,
        taxExemptionRef: v.taxExemptionRef ?? null,
      },
      v.taxRateMode ?? "FIXED",
      v.priceMinor,
    );
    if (gstClassificationError(checkTaxClassification)) {
      return { status: "invalid_tax_classification" };
    }
  }

  // Validate UOM if provided
  if (input.baseUomId) {
    const uom = await db.uom.findUnique({
      where: { id: input.baseUomId, tenantId: input.actor.tenantId },
    });
    if (!uom) return { status: "not_found" };
  }

  // Atomic single transaction for entire Product + all Variants + all links + all stock movements
  let result: { productId: string; variantId: string; variants: Array<{ id: string; sku: string; barcode: string | null }> };
  try {
    result = await db.$transaction(async (tx) => {
      const productData: Record<string, unknown> = {
        tenantId: input.actor.tenantId,
        name: input.name,
        category: input.category,
        brand: input.brand,
        imageUrl: input.imageUrl,
        isActive: input.isActive,
        isDraft: input.isDraft ?? false,
        draftExpiresAt: input.draftExpiresAt ?? null,
        baseUomId: input.baseUomId || null,
      };
      if (input.hsnCode) {
        productData.hsnCode = input.hsnCode;
      }

      const product = await tx.product.create({
        data: productData as Prisma.ProductUncheckedCreateInput,
      });

      let firstCreatedVariantId = "";
      const createdVariants: Array<{ id: string; sku: string; barcode: string | null }> = [];

      for (let i = 0; i < rawVariants.length; i++) {
        const v = rawVariants[i]!;

        // Validate pricing rules: Sale price cannot exceed MRP
        if (v.mrpMinor !== null && v.mrpMinor !== undefined && v.priceMinor > v.mrpMinor) {
          throw new Error("SALE_PRICE_EXCEEDS_MRP");
        }

        // Validate minimum price: Sale price cannot be below minimum price if set
        if (v.minPriceMinor !== null && v.minPriceMinor !== undefined && v.priceMinor < v.minPriceMinor) {
          throw new Error("SALE_PRICE_BELOW_MINIMUM");
        }

        // Service-level enforcement: UNSPECIFIED is not a decided statutory tax treatment and cannot be saved
        if (!v.taxTreatment || v.taxTreatment === GstTaxTreatment.UNSPECIFIED) {
          throw new Error("UNSPECIFIED_TAX_TREATMENT");
        }

        if (!isGstShop && (v.taxTreatment === GstTaxTreatment.TAXABLE || (v.taxRateBp && v.taxRateBp > 0))) {
          throw new Error("INVALID_TAX_CLASSIFICATION");
        }

        const taxClassification = await withRateMode(
          input.actor.tenantId,
          {
            taxRateBp: v.taxRateBp ?? 0,
            taxTreatment: v.taxTreatment,
            taxExemptionRef: v.taxExemptionRef ?? null,
          },
          v.taxRateMode ?? "FIXED",
          v.priceMinor,
        );
        if (gstClassificationError(taxClassification)) {
          throw new Error("INVALID_TAX_CLASSIFICATION");
        }

        // No barcode supplied: draw the tenant's next in-store code in this transaction.
        const suppliedBarcode = v.barcode?.trim() || null;
        const barcode = suppliedBarcode ?? (await nextTenantBarcode(tx, input.actor.tenantId));

        const variantData: Record<string, unknown> = {
          tenantId: input.actor.tenantId,
          productId: product.id,
          sku: v.sku,
          barcode,
          size: v.size,
          colour: v.colour,
          costPriceMinor: v.costPriceMinor ?? null,
          priceMinor: v.priceMinor,
          mrpMinor: v.mrpMinor ?? null,
          ...taxClassification,
          isActive: v.isActive,
        };
        if (v.minPriceMinor !== null && v.minPriceMinor !== undefined) {
          variantData.minPriceMinor = v.minPriceMinor;
        }

        const variant = await tx.productVariant.create({
          data: variantData as Prisma.ProductVariantUncheckedCreateInput,
        });

        if (i === 0) firstCreatedVariantId = variant.id;
        createdVariants.push({ id: variant.id, sku: variant.sku, barcode: variant.barcode });

        // Dual-write: write attribute links (Size/Colour) & primary barcode relationally
        await syncVariantDualWrite(tx, {
          tenantId: input.actor.tenantId,
          variantId: variant.id,
          size: v.size,
          colour: v.colour,
          barcode,
          barcodeType: suppliedBarcode ? v.barcodeType : "INTERNAL",
        });

        // ProductVariantCreated must be enqueued BEFORE any stock movements so ERPNext creates the Item first!
        if (!input.isDraft) {
          await enqueueOutboxEvent(tx, {
            tenantId: input.actor.tenantId,
            eventType: "ProductVariantCreated",
            actorUserId: input.actor.userId,
            correlationId: input.correlationId,
            entityId: variant.id,
            payload: { variantId: variant.id },
          });
        }

        // Opening stock handling: supports explicit per-location openingStock or single store openingQty
        const hasOpeningStock = (v.openingStock && v.openingStock.some((l) => l.quantity > 0)) || (v.openingQty != null && v.openingQty > 0);
        if (hasOpeningStock) {
          // Rule: If opening stock > 0, cost is required unless explicitly flagged as a free sample
          const isSample = v.isFreeSample === true;
          const costMinor = v.costPriceMinor ?? null;
          if (!isSample && (costMinor === null || costMinor === undefined || costMinor <= 0)) {
            throw new Error(`MISSING_OPENING_COST: Cost price is required when opening stock is specified for variant "${v.sku || variant.sku}".`);
          }
        }

        if (v.openingStock && v.openingStock.length > 0) {
          for (const loc of v.openingStock) {
            if (loc.quantity > 0) {
              // Verify store belongs to tenant
              const storeExists = await tx.store.findFirst({
                where: { id: loc.storeId, tenantId: input.actor.tenantId },
                select: { id: true },
              });
              if (!storeExists) {
                throw new Error(`INVALID_STORE: Store ${loc.storeId} does not belong to tenant ${input.actor.tenantId}`);
              }
              const movementCost = v.isFreeSample ? 0 : (v.costPriceMinor ?? null);
              const movement = await applyStockMovement(tx, {
                tenantId: input.actor.tenantId,
                storeId: loc.storeId,
                variantId: variant.id,
                type: "OPENING_BALANCE",
                quantityDelta: Math.round(loc.quantity),
                reason: "Initial catalogue opening stock",
                unitCostMinor: movementCost,
                isFreeSample: v.isFreeSample === true,
                idempotencyKey: `op_${variant.id}_${loc.storeId}_${Date.now()}`,
                actorUserId: input.actor.userId,
              });

              // Queue StockMovementCreated inside the transaction if not draft!
              if (!input.isDraft) {
                await enqueueOutboxEvent(tx, {
                  tenantId: input.actor.tenantId,
                  storeId: loc.storeId,
                  eventType: "StockMovementCreated",
                  entityId: movement.movementId,
                  causationId: `op_${variant.id}_${loc.storeId}`,
                  correlationId: input.correlationId,
                  actorUserId: input.actor.userId,
                  payload: { movementId: movement.movementId },
                });
              }
            }
          }
        } else if (v.openingQty && v.openingQty > 0) {
          let storeId = input.storeId;
          if (!storeId) {
            const defaultStore = await tx.store.findFirst({
              where: { tenantId: input.actor.tenantId },
              orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
              select: { id: true },
            });
            storeId = defaultStore?.id;
          }
          if (storeId) {
            const movementCost = v.isFreeSample ? 0 : (v.costPriceMinor ?? null);
            const movement = await applyStockMovement(tx, {
              tenantId: input.actor.tenantId,
              storeId,
              variantId: variant.id,
              type: "OPENING_BALANCE",
              quantityDelta: Math.round(v.openingQty),
              reason: "Initial catalogue opening stock",
              unitCostMinor: movementCost,
              isFreeSample: v.isFreeSample === true,
              idempotencyKey: `op_${variant.id}_${Date.now()}`,
              actorUserId: input.actor.userId,
            });

            // Queue StockMovementCreated inside the transaction if not draft!
            if (!input.isDraft) {
              await enqueueOutboxEvent(tx, {
                tenantId: input.actor.tenantId,
                storeId,
                eventType: "StockMovementCreated",
                entityId: movement.movementId,
                causationId: `op_${variant.id}`,
                correlationId: input.correlationId,
                actorUserId: input.actor.userId,
                payload: { movementId: movement.movementId },
              });
            }
          }
        }
      }

      return { productId: product.id, variantId: firstCreatedVariantId, variants: createdVariants };
    }, { timeout: 30000, maxWait: 10000 });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "SALE_PRICE_EXCEEDS_MRP") {
        return { status: "price_exceeds_mrp", message: "Variant sale price cannot exceed MRP." };
      }
      if (err.message === "SALE_PRICE_BELOW_MINIMUM") {
        return { status: "price_below_minimum", message: "Variant sale price cannot be below minimum selling price." };
      }
      if (err.message.startsWith("MISSING_OPENING_COST")) {
        return { status: "validation_error", message: err.message };
      }
      if (err.message.startsWith("INVALID_STORE")) {
        return { status: "invalid_store", message: err.message };
      }
      if (err.message === "INVALID_TAX_CLASSIFICATION" || err.message === "UNSPECIFIED_TAX_TREATMENT") {
        return { status: "invalid_tax_classification" };
      }
    }
    const collision = uniqueCollision(err);
    if (collision) return collision;
    throw err;
  }

  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "product.create",
    correlationId: input.correlationId,
    metadata: { productId: result.productId, variantId: result.variantId }
  });

  return { status: "ok", productId: result.productId, variantId: result.variantId, variants: result.variants };
}

export interface UpdateProductInput {
  actor: CatalogActor;
  storeId?: string;
  productId: string;
  name?: string;
  category?: string | null;
  brand?: string | null;
  imageUrl?: string | null;
  hsnCode?: string | null;
  isActive?: boolean;
  baseUomId?: string | null;
  variants?: {
    id?: string;
    sku?: string | null;
    barcode?: string | null;
    size?: string | null;
    colour?: string | null;
    costPriceMinor?: number | null;
    priceMinor: number;
    mrpMinor?: number | null;
    taxRateBp?: number;
    taxRateMode?: TaxRateMode;
    taxTreatment?: GstTaxTreatment;
    taxExemptionRef?: string | null;
    isActive?: boolean;
    openingQty?: number | null;
    isFreeSample?: boolean;
  }[];
  correlationId: string;
}

export type UpdateProductResult =
  | { status: "ok" }
  | { status: "invalid_tax_classification" }
  | { status: "duplicate_product_name" }
  | { status: "duplicate_barcode"; barcode: string }
  | { status: "duplicate_sku"; sku: string }
  | { status: CatalogFailure };

export async function updateProduct(input: UpdateProductInput): Promise<UpdateProductResult> {
  if (!canManageCatalog(input.actor.tenantRole)) {
    return { status: "forbidden" };
  }

  const existing = await db.product.findUnique({
    where: { id_tenantId: { id: input.productId, tenantId: input.actor.tenantId } },
    include: { variants: true },
  });
  if (!existing) return { status: "not_found" };

  if (input.baseUomId) {
    const uom = await db.uom.findUnique({
      where: { id: input.baseUomId, tenantId: input.actor.tenantId },
    });
    if (!uom) return { status: "not_found" };
  }

  const tenant = await db.tenant.findUnique({
    where: { id: input.actor.tenantId },
    select: { taxId: true },
  });
  const isGstShop = Boolean(tenant?.taxId?.trim());

  // Pre-validate variants if provided
  if (input.variants && input.variants.length > 0) {
    const seenSkus = new Set<string>();
    const seenBarcodes = new Set<string>();

    for (const v of input.variants) {
      if (!isGstShop && (v.taxTreatment === GstTaxTreatment.TAXABLE || (v.taxRateBp && v.taxRateBp > 0))) {
        return { status: "invalid_tax_classification" };
      }
      if (v.sku?.trim()) {
        const normalized = v.sku.trim().toUpperCase();
        if (seenSkus.has(normalized)) {
          return { status: "duplicate_sku", sku: v.sku.trim() };
        }
        seenSkus.add(normalized);

        // Check DB for duplicate SKU excluding self
        const existingSku = await db.productVariant.findFirst({
          where: {
            tenantId: input.actor.tenantId,
            sku: v.sku.trim(),
            ...(v.id ? { id: { not: v.id } } : {}),
          },
          select: { id: true },
        });
        if (existingSku) return { status: "duplicate_sku", sku: v.sku.trim() };
      }

      if (v.barcode?.trim()) {
        const barcodeStr = v.barcode.trim();
        if (seenBarcodes.has(barcodeStr)) {
          return { status: "duplicate_barcode", barcode: barcodeStr };
        }
        seenBarcodes.add(barcodeStr);

        // Check DB for duplicate Barcode excluding self
        const existingBarcode = await db.productVariant.findFirst({
          where: {
            tenantId: input.actor.tenantId,
            barcode: barcodeStr,
            ...(v.id ? { id: { not: v.id } } : {}),
          },
          select: { id: true },
        });
        if (existingBarcode) return { status: "duplicate_barcode", barcode: barcodeStr };
      }
    }
  }

  try {
    await db.$transaction(async (tx) => {
      // 1. Update master product info
      const hsnChanged = input.hsnCode !== undefined && input.hsnCode?.trim() !== existing.hsnCode?.trim();
      await tx.product.update({
        where: { id_tenantId: { id: input.productId, tenantId: input.actor.tenantId } },
        data: {
          name: input.name,
          category: input.category,
          brand: input.brand,
          imageUrl: input.imageUrl === undefined ? existing.imageUrl : input.imageUrl,
          isActive: input.isActive,
          hsnCode: input.hsnCode !== undefined ? (input.hsnCode?.trim() || null) : existing.hsnCode,
          baseUomId: input.baseUomId === "" ? null : input.baseUomId,
        },
      });

      // Step 6: Changing a product's HSN must queue ProductVariantUpdated for all its variants
      if (hsnChanged) {
        for (const ev of existing.variants) {
          await enqueueOutboxEvent(tx, {
            tenantId: input.actor.tenantId,
            eventType: "ProductVariantUpdated",
            actorUserId: input.actor.userId,
            correlationId: input.correlationId,
            entityId: ev.id,
            payload: { variantId: ev.id, reason: "HSN_UPDATED" },
            discriminator: Date.now().toString(),
          });
        }
      }

      // 2. Transactional upsert of variants
      if (input.variants && input.variants.length > 0) {
        for (const v of input.variants) {
          const vPrice = v.priceMinor;
          const vMrp = v.mrpMinor ?? null;
          const vCost = v.costPriceMinor ?? null;

          const classification = await withRateMode(
            input.actor.tenantId,
            {
              taxRateBp: v.taxRateBp ?? 0,
              taxTreatment: v.taxTreatment ?? GstTaxTreatment.TAXABLE,
              taxExemptionRef: v.taxExemptionRef ?? null,
            },
            v.taxRateMode ?? "APPAREL_SLAB",
            vPrice,
          );

          if (v.id) {
            // UPDATE existing variant in-place (preserves foreign keys, stock levels, sales)
            const oldVar = existing.variants.find((ev) => ev.id === v.id);
            const wasPriceChanged = oldVar && (oldVar.priceMinor !== vPrice || oldVar.mrpMinor !== vMrp);

            await tx.productVariant.update({
              where: { id: v.id, tenantId: input.actor.tenantId },
              data: {
                sku: v.sku?.trim() || oldVar?.sku,
                barcode: v.barcode?.trim() || oldVar?.barcode,
                size: v.size?.trim() || null,
                colour: v.colour?.trim() || null,
                costPriceMinor: vCost,
                priceMinor: vPrice,
                mrpMinor: vMrp,
                ...classification,
                isActive: v.isActive ?? true,
              },
            });

            // Dual-write: update attribute links (Size/Colour) & primary barcode relationally
            await syncVariantDualWrite(tx, {
              tenantId: input.actor.tenantId,
              variantId: v.id,
              size: v.size?.trim() || oldVar?.size,
              colour: v.colour?.trim() || oldVar?.colour,
              barcode: v.barcode?.trim() || oldVar?.barcode,
            });

            // If master price changed, cancel stale pending price changes
            if (wasPriceChanged) {
              await cancelPendingPriceChanges(tx, { tenantId: input.actor.tenantId, variantId: v.id });
            }

            await enqueueOutboxEvent(tx, {
              tenantId: input.actor.tenantId,
              eventType: "ProductVariantUpdated",
              actorUserId: input.actor.userId,
              correlationId: input.correlationId,
              entityId: v.id,
              payload: { variantId: v.id },
              discriminator: Date.now().toString(),
            });
          } else {
            // CREATE newly added variant
            const cleanSize = v.size?.trim() || null;
            const cleanColour = v.colour?.trim() || null;
            const autoSku =
              v.sku?.trim() ||
              `SKU-${(input.name || existing.name).slice(0, 6).toUpperCase()}-${cleanSize || "STD"}-${randomUUID().slice(0, 4).toUpperCase()}`;
            const suppliedBarcode = v.barcode?.trim() || null;
            const autoBarcode = suppliedBarcode ?? (await nextTenantBarcode(tx, input.actor.tenantId));

            const createdVar = await tx.productVariant.create({
              data: {
                tenantId: input.actor.tenantId,
                productId: input.productId,
                sku: autoSku,
                barcode: autoBarcode,
                size: cleanSize,
                colour: cleanColour,
                costPriceMinor: vCost,
                priceMinor: vPrice,
                mrpMinor: vMrp,
                ...classification,
                isActive: v.isActive ?? true,
              },
            });

            // Dual-write: write attribute links (Size/Colour) & primary barcode relationally
            await syncVariantDualWrite(tx, {
              tenantId: input.actor.tenantId,
              variantId: createdVar.id,
              size: cleanSize,
              colour: cleanColour,
              barcode: autoBarcode,
              ...(suppliedBarcode ? {} : { barcodeType: "INTERNAL" as const }),
            });

            // Apply opening stock if openingQty > 0 for this new variant
            if (v.openingQty && v.openingQty > 0) {
              const isSample = v.isFreeSample === true;
              const costMinor = v.costPriceMinor ?? null;
              if (!isSample && (costMinor === null || costMinor === undefined || costMinor <= 0)) {
                throw new Error(`MISSING_OPENING_COST: Cost price is required when opening stock is specified for variant "${v.sku || autoSku}".`);
              }

              let storeId = input.storeId;
              if (!storeId) {
                const defaultStore = await tx.store.findFirst({
                  where: { tenantId: input.actor.tenantId },
                  orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
                  select: { id: true },
                });
                storeId = defaultStore?.id;
              }
              if (storeId) {
                const movementCost = isSample ? 0 : (v.costPriceMinor ?? null);
                const movement = await applyStockMovement(tx, {
                  tenantId: input.actor.tenantId,
                  storeId,
                  variantId: createdVar.id,
                  type: "OPENING_BALANCE",
                  quantityDelta: Math.round(v.openingQty),
                  reason: "Initial catalogue opening stock",
                  unitCostMinor: movementCost,
                  idempotencyKey: `op_${createdVar.id}_${Date.now()}`,
                  actorUserId: input.actor.userId,
                });

                await enqueueOutboxEvent(tx, {
                  tenantId: input.actor.tenantId,
                  storeId,
                  eventType: "StockMovementCreated",
                  entityId: movement.movementId,
                  causationId: `op_${createdVar.id}`,
                  correlationId: input.correlationId,
                  actorUserId: input.actor.userId,
                  payload: { movementId: movement.movementId },
                });
              }
            }

            await enqueueOutboxEvent(tx, {
              tenantId: input.actor.tenantId,
              eventType: "ProductVariantCreated",
              actorUserId: input.actor.userId,
              correlationId: input.correlationId,
              entityId: createdVar.id,
              payload: { variantId: createdVar.id },
            });
          }
        }
      }
    }, { timeout: 30000, maxWait: 10000 });
  } catch (err: unknown) {
    const collision = uniqueCollision(err);
    if (collision) return collision;
    throw err;
  }

  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "product.update",
    correlationId: input.correlationId,
    metadata: { productId: input.productId, variantCount: input.variants?.length },
  });

  return { status: "ok" };
}

export interface CreateVariantInput {
  actor: CatalogActor;
  storeId?: string;
  productId: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  costPriceMinor?: number | null;
  priceMinor: number;
  mrpMinor: number | null;
  taxRateBp?: number;
  taxTreatment?: GstTaxTreatment;
  taxExemptionRef?: string | null;
  taxRateMode?: TaxRateMode;
  isActive: boolean;
  isDraft?: boolean;
  openingQty?: number | null;
  isFreeSample?: boolean;
  correlationId: string;
}

export type CreateVariantResult =
  | { status: "ok"; variantId: string; barcode: string | null }
  | { status: "invalid_tax_classification" }
  | { status: "duplicate_barcode"; barcode: string }
  | { status: "duplicate_sku"; sku: string }
  | { status: CatalogFailure };

export async function createVariant(input: CreateVariantInput): Promise<CreateVariantResult> {
  if (!canManageCatalog(input.actor.tenantRole)) {
    return { status: "forbidden" };
  }

  // Service-level enforcement: UNSPECIFIED is not a decided statutory tax treatment and cannot be saved
  if (!input.taxTreatment || input.taxTreatment === GstTaxTreatment.UNSPECIFIED) {
    return { status: "invalid_tax_classification" };
  }

  const tenant = await db.tenant.findUnique({
    where: { id: input.actor.tenantId },
    select: { taxId: true },
  });
  const isGstShop = Boolean(tenant?.taxId?.trim());
  if (!isGstShop && (input.taxTreatment === GstTaxTreatment.TAXABLE || (input.taxRateBp && input.taxRateBp > 0))) {
    return { status: "invalid_tax_classification" };
  }

  const taxClassification = await withRateMode(input.actor.tenantId, {
    taxRateBp: input.taxRateBp ?? 0,
    taxTreatment: input.taxTreatment,
    taxExemptionRef: input.taxExemptionRef ?? null,
  }, input.taxRateMode ?? "FIXED", input.priceMinor);
  if (gstClassificationError(taxClassification)) return { status: "invalid_tax_classification" };

  const product = await db.product.findUnique({
    where: { id_tenantId: { id: input.productId, tenantId: input.actor.tenantId } }
  });
  if (!product) return { status: "not_found" };

  // Check unique constraints
  const existingSku = await db.productVariant.findFirst({
    where: { sku: input.sku, tenantId: input.actor.tenantId }
  });
  if (existingSku) return { status: "duplicate_sku", sku: input.sku };

  if (input.barcode) {
    const existingBarcode = await db.productVariant.findFirst({
      where: { barcode: input.barcode, tenantId: input.actor.tenantId }
    });
    if (existingBarcode) return { status: "duplicate_barcode", barcode: input.barcode };
  }

  let variant: { id: string; barcode: string | null };
  try {
  variant = await db.$transaction(async (tx) => {
    // If product is draft or explicitly flagged draft, do not enqueue outbox event
    const isProductDraft = input.isDraft ?? product.isDraft;

    // No barcode supplied: draw the tenant's next in-store code in this transaction.
    const suppliedBarcode = input.barcode?.trim() || null;
    const barcode = suppliedBarcode ?? (await nextTenantBarcode(tx, input.actor.tenantId));

    const v = await tx.productVariant.create({
      data: {
        tenantId: input.actor.tenantId,
        productId: input.productId,
        sku: input.sku,
        barcode,
        size: input.size,
        colour: input.colour,
        costPriceMinor: input.costPriceMinor ?? null,
        priceMinor: input.priceMinor,
        mrpMinor: input.mrpMinor,
        ...taxClassification,
        isActive: input.isActive,
      }
    });

    // Dual-write: write attribute links (Size/Colour) & primary barcode relationally
    await syncVariantDualWrite(tx, {
      tenantId: input.actor.tenantId,
      variantId: v.id,
      size: input.size,
      colour: input.colour,
      barcode,
      ...(suppliedBarcode ? {} : { barcodeType: "INTERNAL" as const }),
    });

    // Apply opening stock movement if openingQty > 0
    if (input.openingQty && input.openingQty > 0) {
      const isSample = input.isFreeSample === true;
      const costMinor = input.costPriceMinor ?? null;
      if (!isSample && (costMinor === null || costMinor === undefined || costMinor <= 0)) {
        throw new Error(`MISSING_OPENING_COST: Cost price is required when opening stock is specified for variant "${input.sku}".`);
      }

      let storeId = input.storeId;
      if (!storeId) {
        const defaultStore = await tx.store.findFirst({
          where: { tenantId: input.actor.tenantId },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          select: { id: true },
        });
        storeId = defaultStore?.id;
      }
      if (storeId) {
        const movementCost = isSample ? 0 : (input.costPriceMinor ?? null);
        const movement = await applyStockMovement(tx, {
          tenantId: input.actor.tenantId,
          storeId,
          variantId: v.id,
          type: "OPENING_BALANCE",
          quantityDelta: Math.round(input.openingQty),
          reason: "Initial catalogue opening stock",
          unitCostMinor: movementCost,
          idempotencyKey: `op_${v.id}_${Date.now()}`,
          actorUserId: input.actor.userId,
        });

        if (!isProductDraft) {
          await enqueueOutboxEvent(tx, {
            tenantId: input.actor.tenantId,
            storeId,
            eventType: "StockMovementCreated",
            entityId: movement.movementId,
            causationId: `op_${v.id}`,
            correlationId: input.correlationId,
            actorUserId: input.actor.userId,
            payload: { movementId: movement.movementId },
          });
        }
      }
    }

    if (!isProductDraft) {
      await enqueueOutboxEvent(tx, {
        tenantId: input.actor.tenantId,
        eventType: "ProductVariantCreated",
        actorUserId: input.actor.userId,
        correlationId: input.correlationId,
        entityId: v.id,
        payload: { variantId: v.id },
      });
    }
    
    return v;
  }, { timeout: 30000, maxWait: 10000 });
  } catch (err: unknown) {
    // A concurrent create can take the same code or SKU after the pre-checks above passed.
    if (isDuplicateBarcodeError(err)) {
      return { status: "duplicate_barcode", barcode: err instanceof DuplicateBarcodeError ? err.barcode : input.barcode?.trim() ?? "" };
    }
    if (isDuplicateSkuError(err)) return { status: "duplicate_sku", sku: input.sku };
    throw err;
  }

  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "variant.create",
    correlationId: input.correlationId,
    metadata: { variantId: variant.id, productId: input.productId }
  });

  return { status: "ok", variantId: variant.id, barcode: variant.barcode };
}

/**
 * Maps a unique violation raised inside a catalogue transaction to the result the caller can
 * show: a barcode or SKU collision is named as such, and only a clash on anything else (the
 * product name/brand index) is reported as a duplicate product name.
 */
function uniqueCollision(
  err: unknown,
):
  | { status: "duplicate_barcode"; barcode: string }
  | { status: "duplicate_sku"; sku: string }
  | { status: "duplicate_product_name" }
  | null {
  if (isDuplicateBarcodeError(err)) {
    return { status: "duplicate_barcode", barcode: err instanceof DuplicateBarcodeError ? err.barcode : "" };
  }
  if (isDuplicateSkuError(err)) return { status: "duplicate_sku", sku: "" };
  const message = err instanceof Error ? err.message : "";
  if (message.includes("product_unique_name_brand") || (err as { code?: string } | null)?.code === "P2002") {
    return { status: "duplicate_product_name" };
  }
  return null;
}

export interface UpdateVariantInput {
  actor: CatalogActor;
  variantId: string;
  sku?: string;
  barcode?: string | null;
  size?: string | null;
  colour?: string | null;
  costPriceMinor?: number | null;
  priceMinor?: number;
  mrpMinor?: number | null;
  taxRateBp?: number;
  taxTreatment?: GstTaxTreatment;
  taxExemptionRef?: string | null;
  taxRateMode?: TaxRateMode;
  isActive?: boolean;
  correlationId: string;
}

export type UpdateVariantResult =
  | { status: "ok" }
  | { status: "invalid_tax_classification" }
  | { status: "duplicate_barcode"; barcode: string }
  | { status: "duplicate_sku"; sku: string }
  | { status: CatalogFailure };

export async function updateVariant(input: UpdateVariantInput): Promise<UpdateVariantResult> {
  if (!canManageCatalog(input.actor.tenantRole)) {
    return { status: "forbidden" };
  }

  const existing = await db.productVariant.findUnique({
    where: { id: input.variantId, tenantId: input.actor.tenantId }
  });
  if (!existing) return { status: "not_found" };

  const classification = await withRateMode(input.actor.tenantId, {
    taxRateBp: input.taxRateBp ?? existing.taxRateBp,
    taxTreatment: input.taxTreatment ?? existing.taxTreatment,
    taxExemptionRef: input.taxExemptionRef === undefined ? existing.taxExemptionRef : input.taxExemptionRef,
  }, input.taxRateMode ?? existing.taxRateMode, input.priceMinor ?? existing.priceMinor);
  if (gstClassificationError(classification)) return { status: "invalid_tax_classification" };

  if (input.sku && input.sku !== existing.sku) {
    const existingSku = await db.productVariant.findFirst({
      where: { sku: input.sku, tenantId: input.actor.tenantId }
    });
    if (existingSku) return { status: "duplicate_sku", sku: input.sku };
  }

  if (input.barcode && input.barcode !== existing.barcode) {
    const existingBarcode = await db.productVariant.findFirst({
      where: { barcode: input.barcode, tenantId: input.actor.tenantId }
    });
    if (existingBarcode) return { status: "duplicate_barcode", barcode: input.barcode };
  }

  await db.$transaction(async (tx) => {
    await tx.productVariant.update({
      where: { id: input.variantId, tenantId: input.actor.tenantId },
      data: {
        sku: input.sku,
        barcode: input.barcode === undefined ? existing.barcode : input.barcode,
        size: input.size === undefined ? existing.size : input.size,
        colour: input.colour === undefined ? existing.colour : input.colour,
        costPriceMinor: input.costPriceMinor === undefined ? existing.costPriceMinor : input.costPriceMinor,
        priceMinor: input.priceMinor,
        mrpMinor: input.mrpMinor === undefined ? existing.mrpMinor : input.mrpMinor,
        ...classification,
        isActive: input.isActive,
      }
    });

    // A price typed here is the shelf price from now on: anything queued behind older stock
    // was decided against the old price and would otherwise silently undo this edit later.
    const mrpAfter = input.mrpMinor === undefined ? existing.mrpMinor : input.mrpMinor;
    const priceAfter = input.priceMinor ?? existing.priceMinor;
    if (priceAfter !== existing.priceMinor || mrpAfter !== existing.mrpMinor) {
      await cancelPendingPriceChanges(tx, { tenantId: input.actor.tenantId, variantId: input.variantId });
    }

    await enqueueOutboxEvent(tx, {
      tenantId: input.actor.tenantId,
      eventType: "ProductVariantUpdated",
      actorUserId: input.actor.userId,
      correlationId: input.correlationId,
      entityId: input.variantId,
      payload: { variantId: input.variantId },
      discriminator: Date.now().toString(),
    });
  });

  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "variant.update",
    correlationId: input.correlationId,
    metadata: { variantId: input.variantId }
  });

  return { status: "ok" };
}
