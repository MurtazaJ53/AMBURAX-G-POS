import { db } from "@/server/db";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { randomUUID } from "node:crypto";

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

import {
  normalizeEmail,
  normalizeGstin,
  normalizeName,
  normalizePhone,
  phoneLookupVariants,
} from "@/lib/customerFields";
import type { Prisma } from "@prisma/client";

export interface CustomerHit {
  id: string;
  name: string;
  phone: string | null;
}

export const CUSTOMER_SEARCH_LIMIT = 20;

export async function getCustomerDue(
  params: { tenantId: string; customerId: string },
  client: { $queryRaw: Prisma.TransactionClient["$queryRaw"] } = db,
): Promise<number> {
  const [salesResult, paymentsResult] = await Promise.all([
    client.$queryRaw<{ sum: bigint | number | null }[]>`
      SELECT SUM("totalMinor" - "paidMinor") AS "sum"
        FROM "sales"
       WHERE "tenantId" = ${params.tenantId}
         AND "customerId" = ${params.customerId}
         AND "status" = 'COMPLETED'
         AND "paidMinor" < "totalMinor"
    `,
    client.$queryRaw<{ sum: bigint | number | null }[]>`
      SELECT SUM("amountMinor") AS "sum"
        FROM "khata_payments"
       WHERE "tenantId" = ${params.tenantId}
         AND "customerId" = ${params.customerId}
    `,
  ]);

  const salesDue = Number(salesResult[0]?.sum ?? 0);
  const paymentsCollected = Number(paymentsResult[0]?.sum ?? 0);
  return Math.max(0, salesDue - paymentsCollected);
}

export async function searchCustomers(params: {
  tenantId: string;
  query: string;
  limit?: number;
}): Promise<CustomerHit[]> {
  const query = params.query.trim();
  if (query.length === 0) return [];

  // If query could be a phone number, extract digits and generate variants
  const digits = query.replace(/\D/g, "");
  const searchVariants = digits.length >= 4 ? phoneLookupVariants(`+91${digits.slice(-10)}`) : [];

  const phoneConditions: Prisma.CustomerWhereInput[] = [
    { phone: { contains: query } },
    ...searchVariants.map((v) => ({ phone: { contains: v } })),
  ];

  const customers = await db.customer.findMany({
    where: {
      tenantId: params.tenantId,
      isActive: true,
      OR: [
        ...phoneConditions,
        { name: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, phone: true },
    orderBy: { name: "asc" },
    take: Math.min(params.limit ?? CUSTOMER_SEARCH_LIMIT, CUSTOMER_SEARCH_LIMIT),
  });

  return customers;
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
  /** Undefined lists every customer; false lists only inactive ones (the Inactive Customers tab). */
  isActive?: boolean;
  cohort?: "active" | "lapsed" | "inactive" | "new";
  page?: number;
}): Promise<CustomerPage> {
  const trimmed = (params.query ?? "").trim();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);

  let cohortCondition: Prisma.CustomerWhereInput = {};
  if (params.cohort === "new") {
    cohortCondition = { createdAt: { gte: thirtyDaysAgo } };
  } else if (params.cohort === "active") {
    cohortCondition = { sales: { some: { status: "COMPLETED", completedAt: { gte: thirtyDaysAgo } } } };
  } else if (params.cohort === "lapsed") {
    cohortCondition = {
      sales: {
        some: { status: "COMPLETED", completedAt: { lt: thirtyDaysAgo, gte: ninetyDaysAgo } },
        none: { status: "COMPLETED", completedAt: { gte: thirtyDaysAgo } },
      },
    };
  }

  const where: Prisma.CustomerWhereInput = {
    tenantId: params.tenantId,
    ...(params.customerType ? { customerType: params.customerType } : {}),
    ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    ...cohortCondition,
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
  /** Completed bills with a named customer — the denominator of an honest average order value. */
  attributedBills: number;
  /** Customer records created since the first of this month. */
  newThisMonth: number;
}

export async function getCustomerSummary(params: { tenantId: string }): Promise<CustomerSummary> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [total, active, grouped, attributed, newThisMonth] = await Promise.all([
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
      _count: { _all: true },
    }),
    db.customer.count({ where: { tenantId: params.tenantId, createdAt: { gte: monthStart } } }),
  ]);

  return {
    total,
    active,
    repeat: grouped.filter((row) => row._count._all > 1).length,
    attributedSalesMinor: attributed._sum.totalMinor ?? 0,
    attributedBills: attributed._count._all ?? 0,
    newThisMonth,
  };
}

export type CreateCustomerResult =
  | { status: "invalid_name" }
  | { status: "validation_error"; field: "name" | "phone" | "email" | "gstin" | "address"; error: string }
  | { status: "ok"; customer: CustomerHit; existing: boolean };

export interface CustomerAddressInput {
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postalCode: string;
  country?: string | null;
}

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
  email?: string | null;
  gstin?: string | null;
  address?: CustomerAddressInput | null;
  actorUserId?: string | null;
  correlationId?: string;
}): Promise<CreateCustomerResult> {
  const nameRes = normalizeName(params.name);
  if (!nameRes.ok) {
    return { status: "validation_error", field: "name", error: nameRes.error };
  }
  const name = nameRes.value;

  let phone: string | null = null;
  if (params.phone !== undefined && params.phone !== null && params.phone.trim() !== "") {
    const phoneRes = normalizePhone(params.phone);
    if (!phoneRes.ok) {
      return { status: "validation_error", field: "phone", error: phoneRes.error };
    }
    phone = phoneRes.value;
  }

  let email: string | null = null;
  if (params.email !== undefined && params.email !== null && params.email.trim() !== "") {
    const emailRes = normalizeEmail(params.email);
    if (!emailRes.ok) {
      return { status: "validation_error", field: "email", error: emailRes.error };
    }
    email = emailRes.value;
  }

  let gstin: string | null = null;
  if (params.gstin !== undefined && params.gstin !== null && params.gstin.trim() !== "") {
    const gstinRes = normalizeGstin(params.gstin);
    if (!gstinRes.ok) {
      return { status: "validation_error", field: "gstin", error: gstinRes.error };
    }
    gstin = gstinRes.value;
  }

  let addressData: { line1: string; line2: string | null; city: string; state: string; postalCode: string; country: string } | null = null;
  if (params.address && (params.address.line1?.trim() || params.address.city?.trim() || params.address.postalCode?.trim())) {
    const l1 = params.address.line1?.trim() || "";
    const city = params.address.city?.trim() || "";
    const postal = params.address.postalCode?.trim() || "";
    if (!l1) {
      return { status: "validation_error", field: "address", error: "Enter street address (Line 1)." };
    }
    if (!city) {
      return { status: "validation_error", field: "address", error: "Enter city." };
    }
    if (!postal) {
      return { status: "validation_error", field: "address", error: "Enter postal / PIN code." };
    }
    addressData = {
      line1: l1.replace(/\s+/g, " "),
      line2: params.address.line2?.trim() ? params.address.line2.trim().replace(/\s+/g, " ") : null,
      city: city.replace(/\s+/g, " "),
      state: (params.address.state?.trim() || "State").replace(/\s+/g, " "),
      postalCode: postal.toUpperCase().replace(/\s+/g, " "),
      country: (params.address.country?.trim() || "IN").toUpperCase().slice(0, 2),
    };
  }

  if (phone) {
    const variants = phoneLookupVariants(phone);
    const existing = await db.customer.findFirst({
      where: {
        tenantId: params.tenantId,
        OR: [{ phone }, ...variants.map((v) => ({ phone: v }))],
      },
      select: { id: true, name: true, phone: true },
    });
    if (existing) return { status: "ok", customer: existing, existing: true };
  }

  const correlationId = params.correlationId ?? randomUUID();

  const created = await db.$transaction(async (tx) => {
    let createdAddressId: string | null = null;
    if (addressData) {
      const addr = await tx.address.create({
        data: {
          tenantId: params.tenantId,
          line1: addressData.line1,
          line2: addressData.line2,
          city: addressData.city,
          state: addressData.state,
          postalCode: addressData.postalCode,
          country: addressData.country,
          type: "BOTH",
        },
      });
      createdAddressId = addr.id;
    }

    const cust = await tx.customer.create({
      data: {
        tenantId: params.tenantId,
        name,
        phone,
        email,
        gstin,
        ...(createdAddressId ? { defaultBillingAddressId: createdAddressId, defaultShippingAddressId: createdAddressId } : {}),
      },
      select: { id: true, name: true, phone: true },
    });

    if (createdAddressId) {
      await tx.customerAddress.create({
        data: {
          tenantId: params.tenantId,
          customerId: cust.id,
          addressId: createdAddressId,
        },
      });
    }

    await enqueueOutboxEvent(tx, {
      tenantId: params.tenantId,
      eventType: "CustomerCreated",
      entityId: cust.id,
      actorUserId: params.actorUserId ?? null,
      correlationId,
      payload: {
        customerId: cust.id,
        name: cust.name,
        phone: cust.phone,
        email,
        gstin,
        address: addressData,
      },
    });

    return cust;
  });

  return { status: "ok", customer: created, existing: false };
}

export interface UpdateCustomerInput {
  tenantId: string;
  id: string;
  name?: string;
  phone?: string | null;
  email?: string | null;
  actorUserId?: string | null;
  correlationId?: string;
}

export type UpdateCustomerResult =
  | { status: "not_found" }
  | { status: "invalid_name" }
  | { status: "phone_conflict" }
  | { status: "ok"; customer: CustomerHit };

export async function updateCustomer(input: UpdateCustomerInput): Promise<UpdateCustomerResult> {
  const existing = await db.customer.findUnique({
    where: { id_tenantId: { id: input.id, tenantId: input.tenantId } },
  });
  if (!existing) return { status: "not_found" };

  let name = existing.name;
  if (input.name !== undefined) {
    name = input.name.trim();
    if (name.length < 2) return { status: "invalid_name" };
  }

  let phone = existing.phone;
  if (input.phone !== undefined) {
    phone = input.phone?.trim() || null;
    if (phone && phone !== existing.phone) {
      const conflict = await db.customer.findUnique({
        where: { tenantId_phone: { tenantId: input.tenantId, phone } },
      });
      if (conflict && conflict.id !== input.id) {
        return { status: "phone_conflict" };
      }
    }
  }

  let email = existing.email;
  if (input.email !== undefined) {
    email = input.email?.trim() || null;
  }

  const correlationId = input.correlationId ?? randomUUID();

  const updated = await db.$transaction(async (tx) => {
    const phoneChanged = input.phone !== undefined && phone !== existing.phone;
    const cust = await tx.customer.update({
      where: { id_tenantId: { id: input.id, tenantId: input.tenantId } },
      data: {
        name,
        phone,
        email,
        ...(phoneChanged ? { phoneVerifiedAt: null } : {}),
      },
      select: { id: true, name: true, phone: true },
    });

    await enqueueOutboxEvent(tx, {
      tenantId: input.tenantId,
      eventType: "CustomerUpdated",
      entityId: cust.id,
      actorUserId: input.actorUserId ?? null,
      correlationId,
      payload: {
        customerId: cust.id,
        name: cust.name,
        phone: cust.phone,
        email,
      },
      discriminator: String(Date.now()),
    });

    return cust;
  });

  return { status: "ok", customer: updated };
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
    billNumber: string;
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
        billNumber: true,
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

export interface CustomerAnalytics {
  /** New customer records per calendar month, oldest first, for the last six months. */
  growth: { label: string; count: number }[];
  /** The five customers with the most completed spend. */
  topBySpend: { id: string; name: string; spentMinor: number }[];
  /** Customer records by type — the only segmentation the schema holds. */
  segments: { type: CustomerType; count: number }[];
}

/**
 * The CRM screen's bottom row. Every figure is a count or sum over real rows: customer
 * creation dates, completed sales attributed to a customer, and the customer type column.
 * There is no loyalty tier or VIP flag in the schema, so "segments" are customer types.
 */
export async function getCustomerAnalytics(params: { tenantId: string }): Promise<CustomerAnalytics> {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const [created, spend, types] = await Promise.all([
    db.customer.findMany({
      where: { tenantId: params.tenantId, createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true },
    }),
    db.sale.groupBy({
      by: ["customerId"],
      where: { tenantId: params.tenantId, status: "COMPLETED", customerId: { not: null } },
      _sum: { totalMinor: true },
      orderBy: { _sum: { totalMinor: "desc" } },
      take: 5,
    }),
    db.customer.groupBy({
      by: ["customerType"],
      where: { tenantId: params.tenantId },
      _count: { _all: true },
    }),
  ]);

  const months: { key: string; label: string; count: number }[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleString("en-IN", { month: "short" }),
      count: 0,
    });
  }
  for (const row of created) {
    const key = `${row.createdAt.getFullYear()}-${row.createdAt.getMonth()}`;
    const month = months.find((m) => m.key === key);
    if (month) month.count += 1;
  }

  const ids = spend.map((row) => row.customerId).filter((id): id is string => id !== null);
  const names = ids.length
    ? await db.customer.findMany({ where: { tenantId: params.tenantId, id: { in: ids } }, select: { id: true, name: true } })
    : [];

  return {
    growth: months.map(({ label, count }) => ({ label, count })),
    topBySpend: spend
      .filter((row) => row.customerId)
      .map((row) => ({
        id: row.customerId as string,
        name: names.find((n) => n.id === row.customerId)?.name ?? "Unknown",
        spentMinor: row._sum.totalMinor ?? 0,
      })),
    segments: types.map((row) => ({ type: row.customerType, count: row._count._all })),
  };
}
