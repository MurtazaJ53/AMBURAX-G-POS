import type { Prisma } from "@prisma/client";

/**
 * Single Canonical Draft Exclusion Filters.
 *
 * Ensures draft products created from purchase bills are hidden across:
 * - POS Till item searches
 * - Barcode lookups
 * - Offline catalog generation
 * - Stock valuation and inventory reports
 * - Dashboard KPI counts
 */

/**
 * Filter fragment for queries targeting the `Product` model directly.
 */
export function notDraftProductWhere(tenantId?: string): Prisma.ProductWhereInput {
  return {
    ...(tenantId ? { tenantId } : {}),
    isDraft: false,
  };
}

/**
 * Filter fragment for queries targeting the `ProductVariant` model.
 */
export function notDraftVariantWhere(tenantId?: string): Prisma.ProductVariantWhereInput {
  return {
    ...(tenantId ? { tenantId } : {}),
    product: {
      isDraft: false,
    },
  };
}
