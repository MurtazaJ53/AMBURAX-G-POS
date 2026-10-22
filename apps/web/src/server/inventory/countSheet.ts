import { db } from "@/server/db";

/**
 * The stock-take count sheet (screen 31): active variants of the business with this store's
 * recorded quantity, including variants never counted here (recorded as null, shown as "—").
 */
export interface CountSheetRow {
  variantId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  category: string | null;
  recorded: number | null;
}

export const COUNT_SHEET_LIMIT = 100;

export async function getCountSheet(params: {
  tenantId: string;
  storeId: string;
  search?: string;
  category?: string;
}): Promise<CountSheetRow[]> {
  const q = (params.search ?? "").trim().slice(0, 100);
  const rows = await db.productVariant.findMany({
    where: {
      tenantId: params.tenantId,
      isActive: true,
      product: { isActive: true, ...(params.category ? { category: params.category } : {}) },
      ...(q
        ? {
            OR: [
              { sku: { contains: q, mode: "insensitive" } },
              { barcode: q },
              { product: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
    take: COUNT_SHEET_LIMIT,
    select: {
      id: true,
      sku: true,
      barcode: true,
      size: true,
      colour: true,
      product: { select: { name: true, category: true } },
      stockLevels: { where: { storeId: params.storeId }, select: { quantity: true } },
    },
  });
  return rows.map((v) => ({
    variantId: v.id,
    productName: v.product.name,
    sku: v.sku,
    barcode: v.barcode,
    size: v.size,
    colour: v.colour,
    category: v.product.category,
    recorded: v.stockLevels[0]?.quantity ?? null,
  }));
}
