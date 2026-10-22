import { randomUUID } from "node:crypto";
import { GstTaxTreatment, type TaxRateMode } from "@prisma/client";
import { db } from "@/server/db";
import { createProduct, createVariant } from "@/server/catalog/catalogService";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { generateCleanBarcode, generateCleanSku } from "@/server/catalog/codeGenerators";

/**
 * Picking items on a purchase the way a shopkeeper thinks: by product name, then size and colour.
 *
 * Search matches product name, SKU or barcode and returns whole products with their variants, each
 * with this store's stock and what it cost last time (excl. GST) and at what GST rate, so the line
 * fills itself. Nobody has to remember an SKU.
 *
 * A product that isn't in the catalogue yet can be created from the purchase screen with all its
 * sizes and colours at once; SKUs are generated (NAME-SIZE-COLOUR-tag) and can be changed later.
 */

export interface PurchaseVariantHit {
  variantId: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  priceMinor: number;
  mrpMinor: number | null;
  costPriceMinor: number | null;
  stock: number | null;
  lastCostMinor: number | null;
  lastGstRateBp: number | null;
  /** The product's own GST rate when it is a fixed taxable rate; a sensible default for input GST. */
  productGstRateBp: number | null;
}

export interface PurchaseProductHit {
  productId: string;
  name: string;
  brand: string | null;
  imageUrl?: string | null;
  variants: PurchaseVariantHit[];
}

export async function searchPurchaseItems(params: { tenantId: string; storeId: string; q: string }): Promise<PurchaseProductHit[]> {
  const q = params.q.trim();
  if (q.length < 2) return [];

  const variants = await db.productVariant.findMany({
    where: {
      tenantId: params.tenantId,
      isActive: true,
      product: { isActive: true },
      OR: [
        { product: { name: { contains: q, mode: "insensitive" } } },
        { product: { brand: { contains: q, mode: "insensitive" } } },
        { sku: { contains: q, mode: "insensitive" } },
        { barcode: { equals: q } },
      ],
    },
    orderBy: [{ product: { name: "asc" } }, { size: "asc" }, { colour: "asc" }],
    take: 60,
    select: {
      id: true,
      sku: true,
      barcode: true,
      size: true,
      colour: true,
      priceMinor: true,
      mrpMinor: true,
      costPriceMinor: true,
      taxTreatment: true,
      taxRateBp: true,
      taxRateMode: true,
      product: { select: { id: true, name: true, brand: true, imageUrl: true } },
    },
  });
  if (variants.length === 0) return [];
  const ids = variants.map((v) => v.id);
  const [stock, lastLines] = await Promise.all([
    db.stockLevel.findMany({
      where: { tenantId: params.tenantId, storeId: params.storeId, variantId: { in: ids } },
      select: { variantId: true, quantity: true },
    }),
    db.purchaseReceiptLine.findMany({
      where: { tenantId: params.tenantId, variantId: { in: ids } },
      orderBy: { receipt: { createdAt: "desc" } },
      distinct: ["variantId"],
      select: { variantId: true, unitCostMinor: true, gstRateBp: true },
    }),
  ]);
  const stockBy = new Map(stock.map((s) => [s.variantId, s.quantity]));
  const lastBy = new Map(lastLines.map((l) => [l.variantId, l]));

  const products = new Map<string, PurchaseProductHit>();
  for (const v of variants) {
    const p = products.get(v.product.id) ?? {
      productId: v.product.id,
      name: v.product.name,
      brand: v.product.brand,
      imageUrl: v.product.imageUrl,
      variants: [],
    };
    const last = lastBy.get(v.id);
    p.variants.push({
      variantId: v.id,
      sku: v.sku,
      barcode: v.barcode,
      size: v.size,
      colour: v.colour,
      priceMinor: v.priceMinor,
      mrpMinor: v.mrpMinor,
      costPriceMinor: v.costPriceMinor ?? null,
      stock: stockBy.get(v.id) ?? null,
      lastCostMinor: last?.unitCostMinor ?? v.costPriceMinor ?? null,
      lastGstRateBp: last?.gstRateBp ?? null,
      productGstRateBp:
        v.taxTreatment === GstTaxTreatment.TAXABLE && v.taxRateMode === "FIXED" && v.taxRateBp > 0 ? v.taxRateBp : null,
    });
    products.set(v.product.id, p);
  }
  return [...products.values()].slice(0, 12);
}

function skuPart(text: string, max: number): string {
  return text
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase()
    .slice(0, max);
}

export type QuickCreateResult =
  | { status: "ok"; product: PurchaseProductHit }
  | { status: "forbidden" }
  | { status: "invalid"; reason: string };

export interface CustomSizePriceInput {
  size?: string | null;
  colour?: string | null;
  barcode?: string | null;
  costPriceMinor?: number | null;
  priceMinor: number;
  mrpMinor?: number | null;
  quantity?: number;
}

/** Create a new product with every size × colour as a variant, ready to receive on a purchase. */
export async function quickCreateProduct(input: {
  actor: { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF"; membershipRole: string | null };
  storeId: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  sizes: string[];
  colours: string[];
  costPriceMinor?: number | null;
  priceMinor: number;
  mrpMinor?: number | null;
  barcode?: string | null;
  customSizePrices?: CustomSizePriceInput[];
  uomCode?: string | null;
  gst: { treatment: GstTaxTreatment; rateMode: TaxRateMode; rateBp: number; exemptionRef?: string | null };
}): Promise<QuickCreateResult> {
  const { actor } = input;
  // Creating catalogue items is the owner's job (canManageCatalog); receiving is inventory's.
  if (actor.tenantRole !== "OWNER" || !canManageInventory(actor)) return { status: "forbidden" };
  const name = input.name.trim();
  if (!name) return { status: "invalid", reason: "Give the product a name." };
  if (!input.gst?.treatment || input.gst.treatment === GstTaxTreatment.UNSPECIFIED) {
    return { status: "invalid", reason: "Select a valid statutory GST treatment (TAXABLE or NON_GST). UNSPECIFIED is not permitted." };
  }
  if (!Number.isInteger(input.priceMinor) || input.priceMinor <= 0) return { status: "invalid", reason: "Enter the selling price." };
  if (input.mrpMinor !== null && input.mrpMinor !== undefined && input.priceMinor > input.mrpMinor) {
    return { status: "invalid", reason: "Selling price cannot exceed MRP." };
  }
  const clean = (list: string[]) => [...new Set(list.map((s) => s.trim()).filter(Boolean))].slice(0, 30);
  const sizes = clean(input.sizes);
  const colours = clean(input.colours);
  const combos: { size: string | null; colour: string | null }[] = [];
  for (const size of sizes.length ? sizes : [null]) for (const colour of colours.length ? colours : [null]) combos.push({ size, colour });
  if (combos.length > 60) return { status: "invalid", reason: "That's more than 60 size and colour combinations. Add fewer at a time." };

  const customMap = new Map<string, CustomSizePriceInput>();
  if (input.customSizePrices?.length) {
    for (const cp of input.customSizePrices) {
      const sKey = cp.size?.trim().toLowerCase() || "";
      const cKey = cp.colour?.trim().toLowerCase() || "";
      if (sKey || cKey) {
        customMap.set(`${sKey}__${cKey}`, cp);
        // Also fallback to size-only lookup
        if (sKey && !customMap.has(sKey)) {
          customMap.set(sKey, cp);
        }
      }
    }
  }

  const preferredUomCode = input.uomCode?.trim().toUpperCase();
  const uom =
    (preferredUomCode
      ? await db.uom.findFirst({ where: { tenantId: actor.tenantId, isActive: true, code: preferredUomCode }, select: { id: true } })
      : null) ??
    (await db.uom.findFirst({ where: { tenantId: actor.tenantId, isActive: true, code: { in: ["PCS", "NOS", "Nos", "PC"] } }, select: { id: true } })) ??
    (await db.uom.findFirst({ where: { tenantId: actor.tenantId, isActive: true }, orderBy: { code: "asc" }, select: { id: true } }));
  if (!uom) return { status: "invalid", reason: "Set up a unit (like PCS) in Settings before adding products." };

  const base = skuPart(name, 8) || "ITEM";
  const tag = randomUUID().slice(0, 4).toUpperCase();
  const skuFor = (c: { size: string | null; colour: string | null }) => {
    const sPart = c.size ? skuPart(c.size, 5) : "STD";
    const clrPart = c.colour ? skuPart(c.colour, 3) : "CLR";
    return `${base}-${sPart}-${clrPart}-${tag}`;
  };
  const tax = {
    taxTreatment: input.gst.treatment,
    taxRateMode: input.gst.rateMode,
    taxRateBp: input.gst.rateBp,
    taxExemptionRef: input.gst.exemptionRef ?? null,
  };
  const correlationId = randomUUID();
  const catalogActor = { tenantId: actor.tenantId, userId: actor.userId, tenantRole: actor.tenantRole };

  const getVariantPricing = (size: string | null, colour: string | null) => {
    const sKey = size?.trim().toLowerCase() || "";
    const cKey = colour?.trim().toLowerCase() || "";
    const custom = customMap.get(`${sKey}__${cKey}`) || (sKey ? customMap.get(sKey) : undefined);
    if (custom) {
      return {
        barcode: custom.barcode?.trim() || null,
        costPriceMinor: custom.costPriceMinor ?? input.costPriceMinor ?? null,
        priceMinor: custom.priceMinor,
        mrpMinor: custom.mrpMinor ?? input.mrpMinor ?? null,
      };
    }
    return {
      barcode: input.barcode?.trim() || null,
      costPriceMinor: input.costPriceMinor ?? null,
      priceMinor: input.priceMinor,
      mrpMinor: input.mrpMinor ?? null,
    };
  };

  // Part 3 Draft Adoption Check:
  // If a product with the same (tenantId, normalized name, normalized brand) already exists:
  // If it is active: fail with "already exists".
  // If it is an existing draft: ADOPT IT (refresh expiry to +24h, add any missing variants, update prices).
  const existingDraft = await db.product.findFirst({
    where: {
      tenantId: actor.tenantId,
      name: { equals: name, mode: "insensitive" },
      brand: input.brand?.trim() ? { equals: input.brand.trim(), mode: "insensitive" } : null,
      isDraft: true,
    },
    include: {
      variants: true,
    },
  });

  let productIdToUse: string | null = null;
  if (existingDraft) {
    productIdToUse = existingDraft.id;
    // Refresh draft expiry so active bills don't get swept
    await db.product.update({
      where: { id: existingDraft.id },
      data: { draftExpiresAt: new Date(Date.now() + 24 * 3600 * 1000) },
    });
  }

  const [first, ...rest] = combos;
  const firstPricing = getVariantPricing(first!.size, first!.colour);
  // Clean EAN-8 auto-generation vs scanned barcode
  const firstBarcode = firstPricing.barcode || (await generateCleanBarcode({ tenantId: actor.tenantId }));
  const firstSku = await generateCleanSku({
    tenantId: actor.tenantId,
    productName: name,
    size: first!.size,
    colour: first!.colour,
  });

  let createdProductId: string;

  if (productIdToUse) {
    createdProductId = productIdToUse;
  } else {
    // Creating as DRAFT (isDraft: true)
    // CRITICAL: We do NOT enqueue ProductVariantCreated events while in draft!
    const draftExpiresAt = new Date(Date.now() + 24 * 3600 * 1000);
    const created = await createProduct({
      actor: catalogActor,
      name,
      category: input.category?.trim() || null,
      brand: input.brand?.trim() || null,
      imageUrl: input.imageUrl?.trim() || null,
      isActive: true,
      isDraft: true,
      draftExpiresAt,
      baseUomId: uom.id,
      correlationId,
      firstVariant: {
        sku: firstSku,
        barcode: firstBarcode,
        size: first!.size,
        colour: first!.colour,
        costPriceMinor: firstPricing.costPriceMinor,
        priceMinor: firstPricing.priceMinor,
        mrpMinor: firstPricing.mrpMinor,
        isActive: true,
        ...tax,
      },
    });

    if (created.status === "invalid_tax_classification") return { status: "invalid", reason: "Check the GST: taxable needs a rate, exempt needs its reference." };
    if (created.status === "forbidden") return { status: "forbidden" };
    if (created.status === "duplicate_barcode") return { status: "invalid", reason: `Barcode ${created.barcode} is already in use by another variant.` };
    if (created.status === "duplicate_sku") return { status: "invalid", reason: `SKU ${created.sku} is already in use.` };
    if (created.status !== "ok") return { status: "invalid", reason: "A product with that name or code already exists. Search for it instead." };

    createdProductId = created.productId;
  }
  for (const c of rest) {
    // If adopting an existing draft, check if variant with this (size, colour) already exists!
    if (existingDraft) {
      const existingVar = existingDraft.variants.find(
        (v) => (v.size ?? "").toLowerCase() === (c.size ?? "").toLowerCase() &&
               (v.colour ?? "").toLowerCase() === (c.colour ?? "").toLowerCase()
      );
      if (existingVar) {
        // Reuse existing variant, update price/cost
        const p = getVariantPricing(c.size, c.colour);
        await db.productVariant.update({
          where: { id: existingVar.id },
          data: {
            priceMinor: p.priceMinor,
            costPriceMinor: p.costPriceMinor ?? undefined,
            mrpMinor: p.mrpMinor ?? undefined,
          },
        });
        continue;
      }
    }

    const p = getVariantPricing(c.size, c.colour);
    const variantBarcode = p.barcode || (await generateCleanBarcode({ tenantId: actor.tenantId }));
    const variantSku = await generateCleanSku({
      tenantId: actor.tenantId,
      productName: name,
      size: c.size,
      colour: c.colour,
    });
    const variantResult = await createVariant({
      actor: catalogActor,
      productId: createdProductId,
      sku: variantSku,
      barcode: variantBarcode,
      size: c.size,
      colour: c.colour,
      costPriceMinor: p.costPriceMinor,
      priceMinor: p.priceMinor,
      mrpMinor: p.mrpMinor,
      isActive: true,
      isDraft: true,
      correlationId,
      ...tax,
    });
    if (variantResult.status === "duplicate_barcode") {
      return { status: "invalid", reason: `Barcode ${variantResult.barcode} is already in use by another variant.` };
    }
  }
  const hits = await searchPurchaseItems({ tenantId: actor.tenantId, storeId: input.storeId, q: `${base}-` });
  const product = hits.find((h) => h.productId === createdProductId) ?? {
    productId: createdProductId,
    name,
    brand: input.brand ?? null,
    imageUrl: input.imageUrl ?? null,
    variants: [],
  };
  return { status: "ok", product };
}
