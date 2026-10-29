import { apiRequest, type ApiResult } from "@/client/platform/apiClient";
import type {
  CatalogItem,
  CompletedSale,
  CustomerHit,
  PaymentMethod,
  PosDevice,
  PosSession,
  ScannedItem,
} from "@/client/pos/types";

/**
 * Every call the till makes, in one place, typed against the routes as they actually are.
 *
 * Nothing here accepts a tenant id, a store id, a cashier id, a price, a tax rate or a total.
 * Those are all resolved or recomputed server-side, and a function signature that offered to
 * send one would be an invitation to trust the client with something it must not own.
 */

export function scanBarcode(
  barcode: string,
  signal?: AbortSignal,
): Promise<ApiResult<{ item: ScannedItem }>> {
  return apiRequest(`/api/v1/pos/scan?barcode=${encodeURIComponent(barcode)}`, { signal });
}

/**
 * Catalogue search — for a person typing, never for a scanner. The scan path is exact by
 * design; routing a scanner through a fuzzy `contains` match is how the wrong item ends up
 * on a bill.
 */
export function searchCatalog(
  query: string,
  signal?: AbortSignal,
): Promise<ApiResult<{ results: CatalogItem[] }>> {
  return apiRequest(`/api/v1/catalog/search?q=${encodeURIComponent(query)}`, { signal });
}

export function listDevices(signal?: AbortSignal): Promise<ApiResult<{ devices: PosDevice[] }>> {
  return apiRequest("/api/v1/pos/devices", { signal });
}

export function currentSession(
  posDeviceId: string,
  signal?: AbortSignal,
): Promise<ApiResult<{ session: PosSession | null }>> {
  return apiRequest(`/api/v1/pos/sessions?posDeviceId=${encodeURIComponent(posDeviceId)}`, {
    signal,
  });
}

export function openSession(
  posDeviceId: string,
): Promise<ApiResult<{ session: PosSession; resumed?: boolean }>> {
  return apiRequest("/api/v1/pos/sessions", { method: "POST", body: { posDeviceId } });
}

export function closeSession(
  sessionId: string,
  closingNote?: string,
): Promise<ApiResult<{ session: PosSession }>> {
  return apiRequest(`/api/v1/pos/sessions/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    // Free text about a handover. Never a counted drawer — no cash model exists.
    body: closingNote ? { closingNote } : {},
  });
}

export function searchCustomers(
  query: string,
  signal?: AbortSignal,
): Promise<ApiResult<{ results: CustomerHit[] }>> {
  return apiRequest(`/api/v1/customers?q=${encodeURIComponent(query)}`, { signal });
}

export function createCustomer(
  name: string,
  phone?: string,
): Promise<ApiResult<{ customer: CustomerHit; existing: boolean }>> {
  return apiRequest("/api/v1/customers", {
    method: "POST",
    body: phone ? { name, phone } : { name },
  });
}

export interface CreateSaleRequest {
  idempotencyKey: string;
  lines: { variantId: string; quantity: number; unitPriceMinor?: number }[];
  customerId: string | null;
  posSessionId: string | null;
  payment: { method: PaymentMethod; reference?: string };
}

/**
 * The sale.
 *
 * Given a longer timeout than everything else on purpose: abandoning this request early is
 * what creates an unknown outcome, and an unknown outcome at a till is more expensive than
 * waiting. When it does time out, the completion machine repeats it with the same key rather
 * than reporting a failure.
 */
export function createSale(
  request: CreateSaleRequest,
): Promise<ApiResult<{ sale: CompletedSale; duplicate: boolean }>> {
  return apiRequest("/api/v1/sales", { method: "POST", body: request, timeoutMs: 30_000 });
}

/**
 * Opening cash for the start-of-shift step: the suggestion (cash counted when this terminal last
 * closed) and, with `sessionId`, what that shift already recorded. Null means none.
 */
export function openingCash(
  posDeviceId: string,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<
  ApiResult<{ suggestedMinor: number | null; fromClosedAt: string | null; sessionFloatMinor: number | null }>
> {
  const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  return apiRequest(`/api/v1/pos/devices/${encodeURIComponent(posDeviceId)}/opening-cash${qs}`, { signal });
}

/** Record a shift's opening cash, once. The server refuses a second figure. */
export function recordOpeningCash(sessionId: string, amountMinor: number): Promise<ApiResult<{ status: string }>> {
  return apiRequest(`/api/v1/pos/sessions/${encodeURIComponent(sessionId)}/opening-cash`, {
    method: "POST",
    body: { amountMinor },
  });
}
