import { Prisma, TenantRole } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { canManageCatalog } from "@/server/catalog/catalogRoles";

export interface CatalogActor {
  tenantId: string;
  userId: string;
  tenantRole: TenantRole;
}

export type CatalogFailure = "forbidden" | "not_found" | "conflict";

export interface CreateProductInput {
  actor: CatalogActor;
  name: string;
  category: string | null;
  brand: string | null;
  imageUrl?: string | null;
  isActive: boolean;
  baseUomId: string | null;
  correlationId: string;
}

export type CreateProductResult = 
  | { status: "ok"; productId: string }
  | { status: CatalogFailure };

export async function createProduct(input: CreateProductInput): Promise<CreateProductResult> {
  if (!canManageCatalog(input.actor.tenantRole)) {
    return { status: "forbidden" };
  }

  // Validate UOM if provided
  if (input.baseUomId) {
    const uom = await db.uom.findUnique({
      where: { id: input.baseUomId, tenantId: input.actor.tenantId }
    });
    if (!uom) return { status: "not_found" };
  }

  const product = await db.product.create({
    data: {
      tenantId: input.actor.tenantId,
      name: input.name,
      category: input.category,
      brand: input.brand,
      imageUrl: input.imageUrl,
      isActive: input.isActive,
      baseUomId: input.baseUomId,
    }
  });

  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "product.create",
    correlationId: input.correlationId,
    metadata: { productId: product.id }
  });

  return { status: "ok", productId: product.id };
}

export interface UpdateProductInput {
  actor: CatalogActor;
  productId: string;
  name?: string;
  category?: string | null;
  brand?: string | null;
  imageUrl?: string | null;
  isActive?: boolean;
  baseUomId?: string | null;
  correlationId: string;
}

export type UpdateProductResult =
  | { status: "ok" }
  | { status: CatalogFailure };

export async function updateProduct(input: UpdateProductInput): Promise<UpdateProductResult> {
  if (!canManageCatalog(input.actor.tenantRole)) {
    return { status: "forbidden" };
  }

  const existing = await db.product.findUnique({
    where: { id_tenantId: { id: input.productId, tenantId: input.actor.tenantId } }
  });
  if (!existing) return { status: "not_found" };

  if (input.baseUomId) {
    const uom = await db.uom.findUnique({
      where: { id: input.baseUomId, tenantId: input.actor.tenantId }
    });
    if (!uom) return { status: "not_found" };
  }

  await db.product.update({
    where: { id_tenantId: { id: input.productId, tenantId: input.actor.tenantId } },
    data: {
      name: input.name,
      category: input.category,
      brand: input.brand,
      imageUrl: input.imageUrl === undefined ? existing.imageUrl : input.imageUrl,
      isActive: input.isActive,
      baseUomId: input.baseUomId,
    }
  });

  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "product.update",
    correlationId: input.correlationId,
    metadata: { productId: input.productId }
  });

  return { status: "ok" };
}

export interface CreateVariantInput {
  actor: CatalogActor;
  productId: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  priceMinor: number;
  mrpMinor: number | null;
  isActive: boolean;
  correlationId: string;
}

export type CreateVariantResult =
  | { status: "ok"; variantId: string }
  | { status: CatalogFailure };

export async function createVariant(input: CreateVariantInput): Promise<CreateVariantResult> {
  if (!canManageCatalog(input.actor.tenantRole)) {
    return { status: "forbidden" };
  }

  const product = await db.product.findUnique({
    where: { id_tenantId: { id: input.productId, tenantId: input.actor.tenantId } }
  });
  if (!product) return { status: "not_found" };

  // Check unique constraints
  const existingSku = await db.productVariant.findFirst({
    where: { sku: input.sku, tenantId: input.actor.tenantId }
  });
  if (existingSku) return { status: "conflict" };

  if (input.barcode) {
    const existingBarcode = await db.productVariant.findFirst({
      where: { barcode: input.barcode, tenantId: input.actor.tenantId }
    });
    if (existingBarcode) return { status: "conflict" };
  }

  const variant = await db.$transaction(async (tx) => {
    const v = await tx.productVariant.create({
      data: {
        tenantId: input.actor.tenantId,
        productId: input.productId,
        sku: input.sku,
        barcode: input.barcode,
        size: input.size,
        colour: input.colour,
        priceMinor: input.priceMinor,
        mrpMinor: input.mrpMinor,
        isActive: input.isActive,
      }
    });
    
    await enqueueOutboxEvent(tx, {
      tenantId: input.actor.tenantId,
      eventType: "ProductVariantCreated",
      actorUserId: input.actor.userId,
      correlationId: input.correlationId,
      entityId: v.id,
      payload: { variantId: v.id },
    });
    
    return v;
  });

  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "variant.create",
    correlationId: input.correlationId,
    metadata: { variantId: variant.id, productId: input.productId }
  });

  return { status: "ok", variantId: variant.id };
}

export interface UpdateVariantInput {
  actor: CatalogActor;
  variantId: string;
  sku?: string;
  barcode?: string | null;
  size?: string | null;
  colour?: string | null;
  priceMinor?: number;
  mrpMinor?: number | null;
  isActive?: boolean;
  correlationId: string;
}

export type UpdateVariantResult =
  | { status: "ok" }
  | { status: CatalogFailure };

export async function updateVariant(input: UpdateVariantInput): Promise<UpdateVariantResult> {
  if (!canManageCatalog(input.actor.tenantRole)) {
    return { status: "forbidden" };
  }

  const existing = await db.productVariant.findUnique({
    where: { id: input.variantId, tenantId: input.actor.tenantId }
  });
  if (!existing) return { status: "not_found" };

  if (input.sku && input.sku !== existing.sku) {
    const existingSku = await db.productVariant.findFirst({
      where: { sku: input.sku, tenantId: input.actor.tenantId }
    });
    if (existingSku) return { status: "conflict" };
  }

  if (input.barcode && input.barcode !== existing.barcode) {
    const existingBarcode = await db.productVariant.findFirst({
      where: { barcode: input.barcode, tenantId: input.actor.tenantId }
    });
    if (existingBarcode) return { status: "conflict" };
  }

  await db.$transaction(async (tx) => {
    await tx.productVariant.update({
      where: { id: input.variantId, tenantId: input.actor.tenantId },
      data: {
        sku: input.sku,
        barcode: input.barcode === undefined ? existing.barcode : input.barcode,
        size: input.size === undefined ? existing.size : input.size,
        colour: input.colour === undefined ? existing.colour : input.colour,
        priceMinor: input.priceMinor,
        mrpMinor: input.mrpMinor === undefined ? existing.mrpMinor : input.mrpMinor,
        isActive: input.isActive,
      }
    });

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
