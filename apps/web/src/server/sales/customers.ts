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

/* ------------------------------------------------- the Customers workspace */

export const CUSTOMER_PAGE_SIZE = 20;

import type { CustomerType } from "@prisma/client";

export interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: Date;
  /** Completed sales attributed to this customer. */
  purchaseCount: number;
  /** Lifetime spend in minor units. */
  totalSpentMinor: number;
  lastPurchaseAt: Date | null;
  customerType: CustomerType;
}

export interface CustomerPage {
  rows: CustomerRow[];
  total: number;
  page: number;
  pageCount: number;
}

/**
 * One page of customers with their real purchase history.
 *
 * The purchase figures are aggregated from committed sales, so they are facts rather than
 * estimates. What the design reference shows and this deliberately omits is a customer
 * *segment* (VIP / Regular / New) and loyalty standing: no segmentation or loyalty model
 * exists, and a badge invented from a spend threshold this product has never defined would
 * be a fabricated metric.
 */
export async function listCustomers(params: {
  tenantId: string;
  query?: string;
  customerType?: CustomerType;
  page?: number;
}): Promise<CustomerPage> {
  const trimmed = (params.query ?? "").trim();
  const where = {
    tenantId: params.tenantId,
    ...(params.customerType ? { customerType: params.customerType } : {}),
    ...(trimmed.length === 0
      ? {}
      : {
          OR: [
            { name: { contains: trimmed, mode: "insensitive" as const } },
            { phone: { contains: trimmed } },
            { email: { contains: trimmed, mode: "insensitive" as const } },
          ],
        }),
  };

  const total = await db.customer.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(params.page ?? 1)), pageCount);

  const customers = await db.customer.findMany({
    where,
    select: { id: true, name: true, phone: true, email: true, isActive: true, createdAt: true, customerType: true },
    orderBy: { name: "asc" },
    skip: (page - 1) * CUSTOMER_PAGE_SIZE,
    take: CUSTOMER_PAGE_SIZE,
  });

  // One grouped aggregate for the whole page rather than a query per row.
  const ids = customers.map((c) => c.id);
  const stats =
    ids.length === 0
      ? []
      : await db.sale.groupBy({
          by: ["customerId"],
          where: { tenantId: params.tenantId, customerId: { in: ids }, status: "COMPLETED" },
          _sum: { totalMinor: true },
          _count: { _all: true },
          _max: { completedAt: true },
        });

  const byCustomer = new Map(stats.map((row) => [row.customerId, row]));

  return {
    rows: customers.map((customer) => {
      const stat = byCustomer.get(customer.id);
      return {
        ...customer,
        purchaseCount: stat?._count._all ?? 0,
        totalSpentMinor: stat?._sum.totalMinor ?? 0,
        lastPurchaseAt: stat?._max.completedAt ?? null,
      };
    }),
    total,
    page,
    pageCount,
  };
}

export interface CustomerSummary {
  total: number;
  active: number;
  /** Customers with more than one completed sale — a real, countable definition. */
  repeat: number;
  /** Lifetime takings attributable to a named customer, in minor units. */
  attributedSalesMinor: number;
}

export async function getCustomerSummary(params: { tenantId: string }): Promise<CustomerSummary> {
  const [total, active, grouped, attributed] = await Promise.all([
    db.customer.count({ where: { tenantId: params.tenantId } }),
    db.customer.count({ where: { tenantId: params.tenantId, isActive: true } }),
    db.sale.groupBy({
      by: ["customerId"],
      where: { tenantId: params.tenantId, status: "COMPLETED", customerId: { not: null } },
      _count: { _all: true },
    }),
    db.sale.aggregate({
      where: { tenantId: params.tenantId, status: "COMPLETED", customerId: { not: null } },
      _sum: { totalMinor: true },
    }),
  ]);

  return {
    total,
    active,
    repeat: grouped.filter((row) => row._count._all > 1).length,
    attributedSalesMinor: attributed._sum.totalMinor ?? 0,
  };
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

export type CustomerDetail = CustomerRow & {
  customerType: string;
  paymentTermsDays: number | null;
  creditLimitMinor: number | null;
  gstin: string | null;
  priceListId: string | null;
  addressCount: number;
  recentSales: Array<{
    id: string;
    completedAt: Date | null;
    totalMinor: number;
    status: string;
  }>;
};

export async function getCustomerDetail(params: {
  tenantId: string;
  id: string;
}): Promise<CustomerDetail | null> {
  const customer = await db.customer.findUnique({
    where: { id_tenantId: { id: params.id, tenantId: params.tenantId } },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      isActive: true,
      createdAt: true,
      customerType: true,
      paymentTermsDays: true,
      creditLimitMinor: true,
      gstin: true,
      priceListId: true,
      _count: {
        select: { addressLinks: true },
      },
    },
  });

  if (!customer) return null;

  const [stats, recentSales] = await Promise.all([
    db.sale.aggregate({
      where: { tenantId: params.tenantId, customerId: params.id, status: "COMPLETED" },
      _sum: { totalMinor: true },
      _count: { _all: true },
      _max: { completedAt: true },
    }),
    db.sale.findMany({
      where: { tenantId: params.tenantId, customerId: params.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        completedAt: true,
        totalMinor: true,
        status: true,
      }
    })
  ]);

  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    isActive: customer.isActive,
    createdAt: customer.createdAt,
    customerType: customer.customerType,
    paymentTermsDays: customer.paymentTermsDays,
    creditLimitMinor: customer.creditLimitMinor,
    gstin: customer.gstin,
    priceListId: customer.priceListId,
    addressCount: customer._count.addressLinks,
    purchaseCount: stats._count._all ?? 0,
    totalSpentMinor: stats._sum.totalMinor ?? 0,
    lastPurchaseAt: stats._max.completedAt ?? null,
    recentSales,
  };
}
