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
  const fields = JSON.stringify(["name"]);
  const path = `/api/resource/${doctype}?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}`;
  let response;
  try {
    response = await client.call(env, ctx, { method: "GET", path });
  } catch (error) {
    if (error instanceof ErpError && error.kind === "not_found") return null;
    throw error;
  }
  const data = (response.body as { data?: Array<{ name: string }> })?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  if (data.length > 1) {
    throw new ErpError({
      kind: "validation_failed",
      message: `Multiple ${doctype} documents match ${field}`,
      correlationId: ctx.correlationId,
    });
  }
  return data[0]?.name ?? null;
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
  const name = (response.body as { data?: { name?: string } })?.data?.name;
  if (!name) {
    throw new ErpError({
      kind: "malformed_response",
      message: `ERPNext did not return a name for the new ${doctype}`,
      correlationId: ctx.correlationId,
    });
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
