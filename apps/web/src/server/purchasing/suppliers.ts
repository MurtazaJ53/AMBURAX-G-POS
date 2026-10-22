import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { normalizeEmail, normalizeGstin, normalizeName, normalizePhone } from "@/lib/customerFields";

/**
 * The supplier directory.
 *
 * Directory data only. Purchases, goods receipts, cost prices and payables are not built, and
 * nothing here computes or implies a balance owed to a supplier.
 *
 * Who may change it is deliberately narrow until the owner decides otherwise: a tenant OWNER or a
 * STORE_MANAGER. Anyone signed in to the store may read it.
 */

export const SUPPLIER_WRITE_ROLES = ["STORE_MANAGER"] as const;

export function canManageSuppliers(params: {
  tenantRole: "OWNER" | "STAFF";
  membershipRole: string | null;
}): boolean {
  if (params.tenantRole === "OWNER") return true;
  return (
    params.membershipRole !== null &&
    (SUPPLIER_WRITE_ROLES as readonly string[]).includes(params.membershipRole)
  );
}

export interface SupplierRow {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  city: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
}

const SUPPLIER_SELECT = {
  id: true,
  name: true,
  contactName: true,
  phone: true,
  email: true,
  gstin: true,
  city: true,
  notes: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.SupplierSelect;

export const SUPPLIER_PAGE_SIZE = 50;

export async function listSuppliers(params: {
  tenantId: string;
  query?: string;
  status?: "active" | "inactive";
}): Promise<SupplierRow[]> {
  const q = (params.query ?? "").trim().slice(0, 100);
  return db.supplier.findMany({
    where: {
      tenantId: params.tenantId,
      isActive: params.status !== "inactive",
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { contactName: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { gstin: { contains: q.toUpperCase() } },
              { city: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: SUPPLIER_PAGE_SIZE,
    select: SUPPLIER_SELECT,
  });
}

export async function countSuppliers(tenantId: string): Promise<{ active: number; inactive: number }> {
  const [active, inactive] = await Promise.all([
    db.supplier.count({ where: { tenantId, isActive: true } }),
    db.supplier.count({ where: { tenantId, isActive: false } }),
  ]);
  return { active, inactive };
}

export interface SupplierInput {
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  city?: string | null;
  notes?: string | null;
}

export type SupplierWriteResult =
  | { status: "ok"; supplier: SupplierRow }
  | { status: "validation_error"; field: string; error: string }
  | { status: "duplicate_name" }
  | { status: "not_found" };

interface NormalizedSupplier {
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  city: string | null;
  notes: string | null;
}

function blank(v: string | null | undefined): boolean {
  return v === undefined || v === null || v.trim() === "";
}

function optionalText(v: string | null | undefined, max: number): string | null {
  if (v === undefined || v === null || v.trim() === "") return null;
  return v.trim().slice(0, max);
}

export function normalizeSupplierInput(
  input: SupplierInput,
): { ok: true; data: NormalizedSupplier } | { ok: false; field: string; error: string } {
  const name = normalizeName(input.name);
  if (!name.ok) return { ok: false, field: "name", error: name.error };

  let phone: string | null = null;
  if (!blank(input.phone)) {
    const r = normalizePhone(input.phone as string);
    if (!r.ok) return { ok: false, field: "phone", error: r.error };
    phone = r.value;
  }
  const email = normalizeEmail(input.email);
  if (!email.ok) return { ok: false, field: "email", error: email.error };
  const gstin = normalizeGstin(input.gstin);
  if (!gstin.ok) return { ok: false, field: "gstin", error: gstin.error };

  return {
    ok: true,
    data: {
      name: name.value,
      contactName: optionalText(input.contactName, 120),
      phone,
      email: email.value,
      gstin: gstin.value,
      city: optionalText(input.city, 80),
      notes: optionalText(input.notes, 500),
    },
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function createSupplier(params: {
  tenantId: string;
  actorUserId: string;
  input: SupplierInput;
  correlationId?: string;
}): Promise<SupplierWriteResult> {
  const n = normalizeSupplierInput(params.input);
  if (!n.ok) return { status: "validation_error", field: n.field, error: n.error };
  const correlationId = params.correlationId ?? randomUUID();

  try {
    const supplier = await db.$transaction(async (tx) => {
      const created = await tx.supplier.create({
        data: { tenantId: params.tenantId, ...n.data },
        select: SUPPLIER_SELECT,
      });
      await writeAuditLogTx(tx, {
        tenantId: params.tenantId,
        userId: params.actorUserId,
        action: "supplier.created",
        correlationId,
        metadata: { supplierId: created.id },
      });
      await enqueueOutboxEvent(tx, {
        tenantId: params.tenantId,
        eventType: "SupplierCreated",
        actorUserId: params.actorUserId,
        correlationId,
        entityId: created.id,
        payload: { supplierId: created.id },
      });
      return created;
    });
    return { status: "ok", supplier };
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "duplicate_name" };
    throw err;
  }
}

export async function updateSupplier(params: {
  tenantId: string;
  actorUserId: string;
  supplierId: string;
  input: SupplierInput;
  correlationId?: string;
}): Promise<SupplierWriteResult> {
  const n = normalizeSupplierInput(params.input);
  if (!n.ok) return { status: "validation_error", field: n.field, error: n.error };
  const correlationId = params.correlationId ?? randomUUID();

  try {
    return await db.$transaction(async (tx) => {
      // Scoped by tenant: an id from another tenant updates nothing and reads as not found.
      const res = await tx.supplier.updateMany({
        where: { id: params.supplierId, tenantId: params.tenantId },
        data: n.data,
      });
      if (res.count === 0) return { status: "not_found" } as const;
      await writeAuditLogTx(tx, {
        tenantId: params.tenantId,
        userId: params.actorUserId,
        action: "supplier.updated",
        correlationId,
        metadata: { supplierId: params.supplierId },
      });
      await enqueueOutboxEvent(tx, {
        tenantId: params.tenantId,
        eventType: "SupplierUpdated",
        actorUserId: params.actorUserId,
        correlationId,
        entityId: params.supplierId,
        payload: { supplierId: params.supplierId },
        discriminator: correlationId,
      });
      const supplier = await tx.supplier.findFirstOrThrow({
        where: { id: params.supplierId, tenantId: params.tenantId },
        select: SUPPLIER_SELECT,
      });
      return { status: "ok", supplier } as const;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "duplicate_name" };
    throw err;
  }
}

export async function setSupplierActive(params: {
  tenantId: string;
  actorUserId: string;
  supplierId: string;
  isActive: boolean;
  correlationId?: string;
}): Promise<{ status: "ok" } | { status: "not_found" }> {
  const correlationId = params.correlationId ?? randomUUID();
  return db.$transaction(async (tx) => {
    const res = await tx.supplier.updateMany({
      where: { id: params.supplierId, tenantId: params.tenantId },
      data: { isActive: params.isActive },
    });
    if (res.count === 0) return { status: "not_found" } as const;
    await writeAuditLogTx(tx, {
      tenantId: params.tenantId,
      userId: params.actorUserId,
      action: params.isActive ? "supplier.reactivated" : "supplier.deactivated",
      correlationId,
      metadata: { supplierId: params.supplierId },
    });
    await enqueueOutboxEvent(tx, {
      tenantId: params.tenantId,
      eventType: "SupplierUpdated",
      actorUserId: params.actorUserId,
      correlationId,
      entityId: params.supplierId,
      payload: { supplierId: params.supplierId },
      discriminator: correlationId,
    });
    return { status: "ok" } as const;
  });
}
