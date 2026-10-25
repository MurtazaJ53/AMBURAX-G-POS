import { ErpClient, type ErpCallContext } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider, type ErpEnvironment } from "@/server/erp/config";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport } from "@/server/erp/transport";

/**
 * Shared plumbing for the adapters that push whole AMBURAX documents (suppliers, purchase
 * receipts, supplier returns, transfers) into ERPNext as ERPNext's own documents. ERPNext is the
 * master for these domains, so every write here is create-once, look-up-first.
 */

/** ERPNext's limit for a `Data` field. AMBURAX text sent into one is cut to fit, never rejected. */
export const ERP_DATA_MAX = 140;

export function erpText(value: string | null | undefined, max = ERP_DATA_MAX): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function newErpClient(transport?: ErpTransport): ErpClient {
  return new ErpClient(transport ?? new HttpErpTransport(), new EnvErpCredentialProvider(), {});
}

export async function requireErpEnvironment(tenantId: string, correlationId: string): Promise<ErpEnvironment> {
  const result = await resolveErpEnvironment(tenantId);
  if (result.status !== "ok") {
    throw new ErpError({
      kind: "configuration_error",
      message: `ERP environment not provisioned for tenant ${tenantId}. Status: ${result.status}`,
      correlationId,
    });
  }
  return result.environment;
}

/**
 * The ERPNext Company a document must post to. Throws a configuration error when the business has
 * no linked company: posting to a company picked by name (the old "Amburax Retail" fallback) put
 * Indian rupee documents into a US-dollar company's books.
 */
export function requireCompany(env: ErpEnvironment, correlationId: string): string {
  if (env.companyId) return env.companyId;
  throw new ErpError({
    kind: "configuration_error",
    message: "This business is not linked to an ERPNext company yet. Connect it to ERPNext first.",
    correlationId,
  });
}

/**
 * 5-minute in-memory cache for warehouse company verification.
 * Avoids extra HTTP round-trips to ERPNext on every stock-affecting event.
 */
const warehouseCompanyCache = new Map<string, { company: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Clear the warehouse company cache (useful in tests).
 */
export function clearWarehouseCompanyCache(): void {
  warehouseCompanyCache.clear();
}

/**
 * Shared fail-closed guard: verifies that a store's ERPNext warehouse exists in ERPNext
 * and strictly belongs to the expected tenant's ERPNext company.
 *
 * Rules:
 * 1. Store must have an ERPNext warehouse provisioned.
 * 2. Tenant must have an ERPNext company provisioned.
 * 3. Warehouse must exist in ERPNext (404/not found is permanent configuration error).
 * 4. Warehouse's company in ERPNext must strictly equal the expected company.
 *    If ERPNext returns empty/null/undefined company, it fails closed.
 */
export async function assertWarehouseCompanyMatch(
  client: ErpClient,
  env: ErpEnvironment,
  ctx: ErpCallContext,
  params: {
    storeId?: string | null;
    warehouseId: string | null | undefined;
    expectedCompany: string | null | undefined;
  }
): Promise<void> {
  const { storeId, warehouseId, expectedCompany } = params;

  if (!warehouseId || !warehouseId.trim()) {
    throw new ErpError({
      kind: "configuration_error",
      message: storeId
        ? `Store ${storeId} has no ERP warehouse provisioned.`
        : `No ERP warehouse provisioned. Cannot sync stock transaction.`,
      correlationId: ctx.correlationId,
    });
  }

  if (!expectedCompany || !expectedCompany.trim()) {
    throw new ErpError({
      kind: "configuration_error",
      message: `Tenant has no ERP company provisioned. Cannot verify warehouse ownership.`,
      correlationId: ctx.correlationId,
    });
  }

  const normalizedWh = warehouseId.trim();
  const normalizedExpectedCompany = expectedCompany.trim();

  // Check cache
  const cached = warehouseCompanyCache.get(normalizedWh);
  if (cached && Date.now() < cached.expiresAt) {
    if (cached.company !== normalizedExpectedCompany) {
      throw new ErpError({
        kind: "configuration_error",
        message: `Cross-tenant error: Warehouse "${normalizedWh}" belongs to company "${cached.company}", but tenant belongs to company "${normalizedExpectedCompany}". Posting blocked.`,
        correlationId: ctx.correlationId,
      });
    }
    return;
  }

  // Fetch warehouse from ERPNext
  let whCompany: string | null = null;
  try {
    const res = await client.call(env, ctx, {
      method: "GET",
      path: `/api/resource/Warehouse/${encodeURIComponent(normalizedWh)}?fields=["company"]`,
    });
    whCompany = (res.body as { data?: { company?: string } })?.data?.company ?? null;
  } catch (err: unknown) {
    if (err instanceof ErpError) {
      if (err.kind === "not_found") {
        throw new ErpError({
          kind: "configuration_error",
          message: `Warehouse "${normalizedWh}" does not exist in ERPNext. Posting blocked.`,
          correlationId: ctx.correlationId,
        });
      }
      throw err;
    }
    throw err;
  }

  // Fail closed if ERPNext returned no company
  if (!whCompany || !whCompany.trim()) {
    throw new ErpError({
      kind: "configuration_error",
      message: `Warehouse "${normalizedWh}" in ERPNext has no linked company. Posting blocked.`,
      correlationId: ctx.correlationId,
    });
  }

  // Cache resolved warehouse company
  warehouseCompanyCache.set(normalizedWh, {
    company: whCompany.trim(),
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  if (whCompany.trim() !== normalizedExpectedCompany) {
    throw new ErpError({
      kind: "configuration_error",
      message: `Cross-tenant error: Warehouse "${normalizedWh}" belongs to company "${whCompany.trim()}", but tenant belongs to company "${normalizedExpectedCompany}". Posting blocked.`,
      correlationId: ctx.correlationId,
    });
  }
}

/** The ERPNext date (YYYY-MM-DD) for a moment, in India time — the stores' business day. */
export function erpDate(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** The ERPNext time (HH:MM:SS) for a moment, in India time — the store's business time. */
export function erpTime(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(11, 19);
}

/**
 * Find a document by a field AMBURAX stamped on it (usually `remarks`). This is the idempotency
 * guard: a re-delivered event finds the document the first delivery made and stops there.
 */
export async function findDocumentName(
  client: ErpClient,
  env: ErpEnvironment,
  ctx: ErpCallContext,
  doctype: string,
  field: string,
  value: string,
): Promise<string | null> {
  const filters = JSON.stringify([[field, "=", value]]);
  const fields = JSON.stringify(["name", "docstatus", "currency", "price_list_currency", "conversion_rate", "plc_conversion_rate"]);
  const path = `/api/resource/${doctype}?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}`;
  let response;
  try {
    response = await client.call(env, ctx, { method: "GET", path });
  } catch (error) {
    if (error instanceof ErpError && error.kind === "not_found") return null;
    throw error;
  }
  const data = (response.body as { data?: Array<{ name: string; docstatus?: number } & Record<string, unknown>> })?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  // Ignore cancelled documents (docstatus === 2) so cancelled idempotency targets allow fresh recreation
  const activeDocs = data.filter((d) => d.docstatus !== 2);
  if (activeDocs.length === 0) return null;
  if (activeDocs.length > 1) {
    throw new ErpError({
      kind: "validation_failed",
      message: `Multiple active ${doctype} documents match ${field}`,
      correlationId: ctx.correlationId,
    });
  }

  const doc = activeDocs[0];
  if (!doc?.name) return null;

  // If the document is a draft (docstatus === 0), validate that it satisfies currency guards
  // before callers attempt to submit or reuse it.
  if (doc.docstatus === 0 && CURRENCY_GUARDED_DOCTYPES.has(doctype)) {
    assertInrCurrencyGuard(doctype, doc.name, doc, ctx.correlationId);
  }

  return doc.name;
}

/**
 * Standard INR pricing & currency payload fields for transactional ERPNext documents.
 * Explicitly pins currency and conversion rates to prevent ERPNext from defaulting
 * to site-wide USD price lists with currency conversion multipliers.
 */
export function inrPricingPayload(
  priceListType: "buying" | "selling",
  customPriceList?: string
): Record<string, unknown> {
  const priceList =
    customPriceList || (priceListType === "buying" ? "Standard Buying" : "Standard Selling");
  return {
    currency: "INR",
    conversion_rate: 1,
    plc_conversion_rate: 1,
    [priceListType === "buying" ? "buying_price_list" : "selling_price_list"]: priceList,
  };
}

/** Doctypes where currency, price list, and conversion rate guards are strictly enforced. */
const CURRENCY_GUARDED_DOCTYPES = new Set([
  "Purchase Receipt",
  "Purchase Invoice",
  "Purchase Order",
  "Sales Invoice",
]);

/**
 * Asserts that an ERPNext document carries strictly INR currency and 1.0 conversion rates.
 * Applied immediately after creation (before submission) to prevent contaminting
 * the General Ledger or Stock Ledger with inflated valuation or foreign currency tags.
 */
export function assertInrCurrencyGuard(
  doctype: string,
  docName: string,
  doc: Record<string, unknown>,
  correlationId: string,
  isReturn?: boolean
): void {
  if (!CURRENCY_GUARDED_DOCTYPES.has(doctype)) {
    return;
  }

  const currency = doc.currency != null ? String(doc.currency).trim() : undefined;
  const priceListCurrency = doc.price_list_currency != null ? String(doc.price_list_currency).trim() : undefined;
  const rawConversionRate = doc.conversion_rate != null ? Number(doc.conversion_rate) : 1;
  const rawPlcConversionRate = doc.plc_conversion_rate != null ? Number(doc.plc_conversion_rate) : 1;

  const hasInvalidCurrency = currency !== undefined && currency !== "INR";
  const hasInvalidPlcCurrency = priceListCurrency !== undefined && priceListCurrency !== "INR";
  const hasInvalidRate = rawConversionRate !== 1;
  const hasInvalidPlcRate = rawPlcConversionRate !== 1;

  if (hasInvalidCurrency || hasInvalidPlcCurrency || hasInvalidRate || hasInvalidPlcRate) {
    if (isReturn && currency === "USD") {
      throw new ErpError({
        kind: "currency_mismatch",
        message: `ERPNext ${doctype} ${docName} failed currency guard: Return inherited currency=${currency} from an original USD-labelled invoice. Submission aborted.`,
        correlationId,
      });
    }

    throw new ErpError({
      kind: "currency_mismatch",
      message: `ERPNext ${doctype} ${docName} failed currency guard: currency=${currency}, price_list_currency=${priceListCurrency}, conversion_rate=${rawConversionRate}, plc_conversion_rate=${rawPlcConversionRate}. Expected strictly INR and 1.0. Submission aborted to prevent ledger contamination.`,
      correlationId,
    });
  }
}

/** Create a document and, for submittable doctypes, submit it. Returns the ERPNext name. */
export async function createDocument(
  client: ErpClient,
  env: ErpEnvironment,
  ctx: ErpCallContext,
  doctype: string,
  doc: Record<string, unknown>,
  idempotencyKey: string,
  submit: boolean,
): Promise<string> {
  const response = await client.call(env, ctx, {
    method: "POST",
    path: `/api/resource/${doctype}`,
    body: { doctype, ...doc },
    idempotencyKey,
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new ErpError({
      kind: "server_error",
      message: `Failed to create ${doctype}: HTTP ${response.status}`,
      correlationId: ctx.correlationId,
    });
  }
  const createdData = (response.body as { data?: Record<string, unknown> })?.data;
  const name = createdData?.name as string | undefined;
  if (!name) {
    throw new ErpError({
      kind: "malformed_response",
      message: `ERPNext did not return a name for the new ${doctype}`,
      correlationId: ctx.correlationId,
    });
  }

  // Currency guard check before submission
  if (createdData) {
    assertInrCurrencyGuard(doctype, name, createdData, ctx.correlationId, Boolean(doc.is_return));
  }

  if (submit) {
    await client.call(env, ctx, {
      method: "PUT",
      path: `/api/resource/${doctype}/${encodeURIComponent(name)}`,
      body: { docstatus: 1 },
    });
  }
  return name;
}

/** ERPNext method that renames a cancelled invoice's tracking id (scripts/ops/erpnext). */
export const RETIRE_CANCELLED_METHOD = "/api/method/amburax_retire_cancelled_id";

/**
 * Move a cancelled document's AMBURAX tracking id out of the way so the record can be synced
 * again, keeping ERPNext's unique constraint on that field.
 *
 * The cancelled document stays (GST audit trail); its id becomes "<id>-CANCELLED-<n>", n the
 * next number no other document uses. ERPNext refuses REST edits to cancelled documents, so the
 * rename is done by the `amburax_retire_cancelled_id` server method. The document is read back
 * afterwards, and anything other than the expected id on a still-cancelled document stops the
 * sync with an error, so a new document is never created next to one that still holds the id.
 */
export async function retireCancelledTrackingId(
  client: ErpClient,
  env: ErpEnvironment,
  ctx: ErpCallContext,
  params: { doctype: "Sales Invoice"; fieldname: "amburax_sale_id"; docName: string; baseId: string },
): Promise<string> {
  const { doctype, fieldname, docName, baseId } = params;
  const prefix = `${baseId}-CANCELLED-`;

  const usedFilters = JSON.stringify([[fieldname, "like", `${prefix}%`]]);
  const used = await client.call(env, ctx, {
    method: "GET",
    path: `/api/resource/${doctype}?filters=${encodeURIComponent(usedFilters)}&fields=${encodeURIComponent(JSON.stringify([fieldname]))}&limit_page_length=0`,
  });
  const usedRows = (used.body as { data?: Array<Record<string, unknown>> })?.data ?? [];
  const highest = usedRows.reduce((max, row) => {
    const n = Number(String(row[fieldname] ?? "").slice(prefix.length));
    return Number.isInteger(n) && n > max ? n : max;
  }, 0);
  const value = `${prefix}${highest + 1}`;

  try {
    await client.call(env, ctx, {
      method: "POST",
      path: RETIRE_CANCELLED_METHOD,
      body: { doctype, name: docName, fieldname, base_id: baseId, value },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ErpError({
      // A missing method is a site setup gap, not weather: stop rather than retry forever.
      kind: error instanceof ErpError && error.kind !== "not_found" ? error.kind : "configuration_error",
      message: `Cannot re-sync ${baseId}: renaming cancelled ${doctype} ${docName} failed (${reason}). Is amburax_retire_cancelled_id installed on this site? No new ${doctype} was created.`,
      correlationId: ctx.correlationId,
    });
  }

  const after = await client.call(env, ctx, {
    method: "GET",
    path: `/api/resource/${doctype}/${encodeURIComponent(docName)}`,
  });
  const doc = (after.body as { data?: Record<string, unknown> })?.data ?? {};
  if (doc[fieldname] !== value || doc["docstatus"] !== 2) {
    throw new ErpError({
      kind: "conflict",
      message: `Cannot re-sync ${baseId}: cancelled ${doctype} ${docName} still reads ${fieldname}=${String(doc[fieldname])} (docstatus ${String(doc["docstatus"])}) after the rename. No new ${doctype} was created.`,
      correlationId: ctx.correlationId,
    });
  }
  return value;
}
