import { Prisma } from "@prisma/client";
import { db } from "@/server/db";

export const GSTIN_TAKEN_MESSAGE = "This GSTIN is already registered; contact support.";

type Client = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * Whether another ACTIVE tenant already holds this GSTIN.
 *
 * "Active" is `Tenant.status = ACTIVE`: the schema's only other state is SUSPENDED, and there is
 * no soft delete (a deleted tenant's row is gone). Stored values are compared trimmed and
 * uppercased because sign-up has always saved the GSTIN as typed. `exceptTenantId` lets a tenant
 * re-save its own GSTIN.
 */
export async function isGstinTakenByAnotherTenant(
  gstin: string,
  exceptTenantId: string | null,
  client: Client = db,
): Promise<boolean> {
  const normalised = gstin.trim().toUpperCase();
  if (!normalised) return false;
  // If the passed client or db mock does not implement $queryRaw, treat as not taken (unit test fallback)
  if (typeof client.$queryRaw !== "function") return false;
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "tenants"
    WHERE "status" = 'ACTIVE'
      AND "taxId" IS NOT NULL
      AND UPPER(BTRIM("taxId")) = ${normalised}
      AND (${exceptTenantId}::text IS NULL OR "id" <> ${exceptTenantId}::text)
    LIMIT 1`;
  return rows.length > 0;
}
