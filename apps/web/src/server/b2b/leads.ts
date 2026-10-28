import { randomUUID } from "node:crypto";
import type { LeadStage, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";
import { normalizeEmail, normalizeName, normalizePhone } from "@/lib/customerFields";

/**
 * The B2B lead pipeline: prospective trade buyers and the stage each one is at.
 *
 * Stage is a label the team moves by hand. Nothing here creates a customer, a quotation or an
 * order, and "won" does not imply revenue. Same write rule as suppliers until the owner sets one:
 * a tenant OWNER or a STORE_MANAGER changes leads; any store member may view them.
 */

export const LEAD_STAGES: readonly LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"];

export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  WON: "Won",
  LOST: "Lost",
};

export function isLeadStage(v: unknown): v is LeadStage {
  return typeof v === "string" && (LEAD_STAGES as readonly string[]).includes(v);
}

export function canManageLeads(params: { tenantRole: "OWNER" | "STAFF"; membershipRole: string | null }): boolean {
  return params.tenantRole === "OWNER" || params.membershipRole === "STORE_MANAGER";
}

const LEAD_SELECT = {
  id: true,
  company: true,
  contactName: true,
  phone: true,
  email: true,
  city: true,
  source: true,
  notes: true,
  stage: true,
  updatedAt: true,
} satisfies Prisma.LeadSelect;

export type LeadRow = Prisma.LeadGetPayload<{ select: typeof LEAD_SELECT }>;

export const LEAD_LIST_LIMIT = 200;

export async function listLeads(params: { tenantId: string; query?: string }): Promise<LeadRow[]> {
  const q = (params.query ?? "").trim().slice(0, 100);
  return db.lead.findMany({
    where: {
      tenantId: params.tenantId,
      ...(q
        ? {
            OR: [
              { company: { contains: q, mode: "insensitive" } },
              { contactName: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { city: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    take: LEAD_LIST_LIMIT,
    select: LEAD_SELECT,
  });
}

export interface LeadInput {
  company: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  source?: string | null;
  notes?: string | null;
  stage?: string | null;
}

export type LeadWriteResult =
  | { status: "ok"; lead: LeadRow }
  | { status: "validation_error"; field: string; error: string }
  | { status: "not_found" };

function optionalText(v: string | null | undefined, max: number): string | null {
  if (v === undefined || v === null || v.trim() === "") return null;
  return v.trim().slice(0, max);
}

export function normalizeLeadInput(input: LeadInput):
  | {
      ok: true;
      data: {
        company: string;
        contactName: string | null;
        phone: string | null;
        email: string | null;
        city: string | null;
        source: string | null;
        notes: string | null;
        stage: LeadStage;
      };
    }
  | { ok: false; field: string; error: string } {
  const company = normalizeName(input.company);
  if (!company.ok) return { ok: false, field: "company", error: "Enter the company name." };
  let phone: string | null = null;
  if (input.phone && input.phone.trim() !== "") {
    const r = normalizePhone(input.phone);
    if (!r.ok) return { ok: false, field: "phone", error: r.error };
    phone = r.value;
  }
  const email = normalizeEmail(input.email);
  if (!email.ok) return { ok: false, field: "email", error: email.error };
  const stage = input.stage ?? "NEW";
  if (!isLeadStage(stage)) return { ok: false, field: "stage", error: "Choose a valid stage." };
  return {
    ok: true,
    data: {
      company: company.value,
      contactName: optionalText(input.contactName, 120),
      phone,
      email: email.value,
      city: optionalText(input.city, 80),
      source: optionalText(input.source, 80),
      notes: optionalText(input.notes, 1000),
      stage,
    },
  };
}

export async function createLead(params: {
  tenantId: string;
  actorUserId: string;
  input: LeadInput;
}): Promise<LeadWriteResult> {
  const n = normalizeLeadInput(params.input);
  if (!n.ok) return { status: "validation_error", field: n.field, error: n.error };
  const lead = await db.$transaction(async (tx) => {
    const created = await tx.lead.create({ data: { tenantId: params.tenantId, ...n.data }, select: LEAD_SELECT });
    await writeAuditLogTx(tx, {
      tenantId: params.tenantId,
      userId: params.actorUserId,
      action: "lead.created",
      correlationId: randomUUID(),
      metadata: { leadId: created.id, stage: created.stage },
    });
    return created;
  });
  return { status: "ok", lead };
}

export async function updateLead(params: {
  tenantId: string;
  actorUserId: string;
  leadId: string;
  input: LeadInput;
}): Promise<LeadWriteResult> {
  const n = normalizeLeadInput(params.input);
  if (!n.ok) return { status: "validation_error", field: n.field, error: n.error };
  return db.$transaction(async (tx) => {
    const res = await tx.lead.updateMany({ where: { id: params.leadId, tenantId: params.tenantId }, data: n.data });
    if (res.count === 0) return { status: "not_found" } as const;
    await writeAuditLogTx(tx, {
      tenantId: params.tenantId,
      userId: params.actorUserId,
      action: "lead.updated",
      correlationId: randomUUID(),
      metadata: { leadId: params.leadId, stage: n.data.stage },
    });
    const lead = await tx.lead.findFirstOrThrow({
      where: { id: params.leadId, tenantId: params.tenantId },
      select: LEAD_SELECT,
    });
    return { status: "ok", lead } as const;
  });
}

export async function moveLeadStage(params: {
  tenantId: string;
  actorUserId: string;
  leadId: string;
  stage: string;
}): Promise<{ status: "ok" } | { status: "not_found" } | { status: "invalid_stage" }> {
  if (!isLeadStage(params.stage)) return { status: "invalid_stage" };
  const stage = params.stage;
  return db.$transaction(async (tx) => {
    const res = await tx.lead.updateMany({ where: { id: params.leadId, tenantId: params.tenantId }, data: { stage } });
    if (res.count === 0) return { status: "not_found" } as const;
    await writeAuditLogTx(tx, {
      tenantId: params.tenantId,
      userId: params.actorUserId,
      action: "lead.stage_changed",
      correlationId: randomUUID(),
      metadata: { leadId: params.leadId, stage },
    });
    return { status: "ok" } as const;
  });
}

/**
 * Phase 9: Convert WON Lead into Registered Trade Customer & B2B Draft Order
 */
export async function convertLeadToOrder(params: {
  tenantId: string;
  actorUserId: string;
  leadId: string;
  storeId?: string | null;
}): Promise<{ status: "ok"; customerId: string; orderNumber: string } | { status: "error"; reason: string }> {
  const lead = await db.lead.findFirst({
    where: { id: params.leadId, tenantId: params.tenantId },
  });
  if (!lead) return { status: "error", reason: "Lead not found." };

  const store = params.storeId
    ? await db.store.findFirst({ where: { id: params.storeId, tenantId: params.tenantId } })
    : await db.store.findFirst({ where: { tenantId: params.tenantId, isDefault: true } });

  if (!store) return { status: "error", reason: "No active store found to attribute wholesale order." };

  const defaultUom = await db.uom.findFirst({ where: { tenantId: params.tenantId } });
  if (!defaultUom) return { status: "error", reason: "Default unit of measure missing." };

  // First sample active product variant for line item scaffolding
  const sampleVariant = await db.productVariant.findFirst({
    where: { tenantId: params.tenantId, isActive: true },
  });

  return db.$transaction(async (tx) => {
    // 1. Create or link Trade Customer
    let customer = lead.phone
      ? await tx.customer.findFirst({ where: { tenantId: params.tenantId, phone: lead.phone } })
      : null;

    if (!customer) {
      customer = await tx.customer.create({
        data: {
          tenantId: params.tenantId,
          name: lead.company,
          phone: lead.phone,
          email: lead.email,
          isActive: true,
        },
      });
    }

    // 2. Mark Lead as WON
    await tx.lead.update({
      where: { id: lead.id },
      data: { stage: "WON" },
    });

    // 3. Generate B2B Wholesale Order
    const updatedStore = await tx.store.update({
      where: { id: store.id },
      data: { nextOrderSeq: { increment: 1 } },
      select: { code: true, nextOrderSeq: true },
    });

    const orderNumber = `${updatedStore.code}-B2B-${String(updatedStore.nextOrderSeq).padStart(6, "0")}`;
    const idempotencyKey = `b2b-lead-${lead.id}-${params.tenantId}`;

    const itemsData = sampleVariant
      ? [
          {
            tenantId: params.tenantId,
            variantId: sampleVariant.id,
            uomId: defaultUom.id,
            quantity: 10, // Wholesale minimum sample box
            fulfilledQuantity: 0,
            unitPriceMinor: sampleVariant.priceMinor,
            lineTotalMinor: sampleVariant.priceMinor * 10,
            skuSnapshot: sampleVariant.sku,
            nameSnapshot: `Wholesale Lot: ${sampleVariant.sku}`,
            uomCodeSnapshot: defaultUom.code,
          },
        ]
      : [];

    const subtotalMinor = itemsData.reduce((sum, it) => sum + it.lineTotalMinor, 0);

    const createdOrder = await tx.order.create({
      data: {
        tenantId: params.tenantId,
        storeId: store.id,
        orderNumber,
        customerId: customer.id,
        status: "DRAFT",
        currency: "INR",
        subtotalMinor,
        version: 1,
        idempotencyKey,
        createdByUserId: params.actorUserId,
        items: {
          create: itemsData,
        },
        addresses: {
          create: [
            {
              type: "BILLING",
              line1: lead.company,
              city: lead.city || "Commercial Hub",
              state: "State",
              postalCode: "560001",
              country: "India",
              contactName: lead.contactName || lead.company,
              contactPhone: lead.phone || "9876543210",
            },
          ],
        },
      },
    });

    await writeAuditLogTx(tx, {
      tenantId: params.tenantId,
      userId: params.actorUserId,
      action: "lead.converted_to_order",
      correlationId: randomUUID(),
      metadata: { leadId: lead.id, customerId: customer.id, orderNumber: createdOrder.orderNumber },
    });

    return { status: "ok", customerId: customer.id, orderNumber: createdOrder.orderNumber };
  });
}
