import type { ApiResult } from "@/client/platform/apiClient";
import { presentError, type PresentedError } from "@/client/platform/errorCatalog";
import type { ScannedItem } from "@/client/pos/types";

/**
 * What a barcode scan meant.
 *
 * This exists as its own pure function because the three failures it distinguishes are the
 * three a counter most often confuses, and collapsing any pair of them produces a cashier
 * arguing with a customer about the wrong thing:
 *
 *   not_found      the catalogue has no such barcode
 *   not_for_sale   the item exists and is withdrawn
 *   found          the item exists and may be sold
 *
 * A fourth confusion is handled by *not* being represented here: stock. `stockQuantity: null`
 * means this store has never counted the variant, which is not zero, and neither value blocks
 * a scan. Stock is shown, never used to refuse.
 */

export type ScanOutcome =
  | { kind: "found"; item: ScannedItem }
  /** The variant, or its product, has been withdrawn. Returned *with* the item so the screen can name it. */
  | { kind: "not_for_sale"; item: ScannedItem }
  | { kind: "not_found"; barcode: string }
  | { kind: "error"; error: PresentedError };

export function classifyScan(
  barcode: string,
  result: ApiResult<{ item: ScannedItem }>,
): ScanOutcome {
  if (result.ok) {
    const item = result.data.item;
    return item.isActive ? { kind: "found", item } : { kind: "not_for_sale", item };
  }

  // Only a 404 is "no such barcode". Anything else is a failure of the lookup, not a verdict
  // about the item, and saying "barcode not found" for a 503 would be a lie the cashier acts on.
  if (result.kind === "api" && result.status === 404) {
    return { kind: "not_found", barcode };
  }

  return { kind: "error", error: presentError(result) };
}

/** How a stock figure is allowed to be worded. Null is never "0". */
export function stockLabel(quantity: number | null): string {
  if (quantity === null) return "Not counted";
  if (quantity <= 0) return "No stock recorded";
  return `${quantity} in stock`;
}
