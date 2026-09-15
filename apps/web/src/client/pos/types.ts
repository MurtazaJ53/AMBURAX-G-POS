/**
 * The shapes the till receives from the API.
 *
 * Declared here rather than imported from the server modules on purpose: these are the wire
 * shapes after JSON, so every `Date` the server selected has already become a string. Reusing
 * the server interfaces would type `openedAt` as `Date` and be wrong at runtime in exactly the
 * place — a shift clock on a counter screen — where nobody would notice until it rendered
 * "Invalid Date".
 */

export interface CatalogItem {
  variantId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  priceMinor: number;
  taxRateBp: number;
  /**
   * Null means this store has never counted the variant. That is genuinely different from
   * zero and must never be rendered as "0 in stock" (ADR-080).
   */
  stockQuantity: number | null;
}

/** What a scan returns. `isActive` is present here and absent from search results. */
export interface ScannedItem extends CatalogItem {
  isActive: boolean;
}

export interface CustomerHit {
  id: string;
  name: string;
  phone: string | null;
}

export type PosDeviceStatus = "PENDING_ACTIVATION" | "PAIRING_EXPIRED" | "ACTIVE" | "DISABLED";

export interface PosDevice {
  id: string;
  name: string;
  code: string;
  storeId: string;
  status: PosDeviceStatus;
  activeSessionId: string | null;
  lastSeenAt: string | null;
  scanSoundEnabled: boolean;
  showProductImages: boolean;
}

export interface PosSession {
  id: string;
  storeId: string;
  posDeviceId: string;
  cashierUserId: string;
  openedAt: string;
  closedAt: string | null;
  closingNote: string | null;
  isOpen: boolean;
}

export type PaymentMethod = "CASH" | "UPI" | "CARD";

export interface CompletedSale {
  id: string;
  billNumber: string;
  totalMinor: number;
  subtotalMinor: number;
  taxMinor: number;
  discountMinor: number;
  paidMinor: number;
  paymentStatus: string;
  erpSyncStatus: string;
  completedAt: string;
}
