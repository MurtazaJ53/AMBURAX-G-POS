import { db } from "@/server/db";

/**
 * Customer lookup for the counter.
 *
 * Search and selection are **reads only**. Selecting a customer never creates a row —
 * that, plus `@@unique([tenantId, phone])`, is what keeps a till from accumulating three
 * "Priya" records because the operator searched three times.
 *
 * Creation is a separate, deliberate action, and it resolves on phone first so pressing
 * "add" twice cannot duplicate either.
 */

export interface CustomerHit {
  id: string;
  name: string;
  phone: string | null;
}

export const CUSTOMER_SEARCH_LIMIT = 20;

export async function searchCustomers(params: {
  tenantId: string;
  query: string;
  limit?: number;
}): Promise<CustomerHit[]> {
  const query = params.query.trim();
  if (query.length === 0) return [];

  return db.customer.findMany({
    where: {
      tenantId: params.tenantId,
      isActive: true,
      OR: [{ phone: { contains: query } }, { name: { contains: query, mode: "insensitive" } }],
    },
    select: { id: true, name: true, phone: true },
    orderBy: { name: "asc" },
    take: Math.min(params.limit ?? CUSTOMER_SEARCH_LIMIT, CUSTOMER_SEARCH_LIMIT),
  });
}

export type CreateCustomerResult =
  | { status: "invalid_name" }
  | { status: "ok"; customer: CustomerHit; existing: boolean };

/**
 * Attach a walk-in customer.
 *
 * Phone is the retail identity key, so a repeat submission for the same number returns the
 * existing record rather than creating a second one. Without a phone there is nothing to
 * deduplicate on, so a plain create is the honest behaviour — the operator is recording a
 * name against this bill, not registering a person.
 */
export async function createCustomer(params: {
  tenantId: string;
  name: string;
  phone?: string | null;
}): Promise<CreateCustomerResult> {
  const name = params.name.trim();
  if (name.length < 2) return { status: "invalid_name" };

  const phone = params.phone?.trim() || null;

  if (phone) {
    const existing = await db.customer.findUnique({
      where: { tenantId_phone: { tenantId: params.tenantId, phone } },
      select: { id: true, name: true, phone: true },
    });
    if (existing) return { status: "ok", customer: existing, existing: true };
  }

  const created = await db.customer.create({
    data: { tenantId: params.tenantId, name, phone },
    select: { id: true, name: true, phone: true },
  });
  return { status: "ok", customer: created, existing: false };
}
