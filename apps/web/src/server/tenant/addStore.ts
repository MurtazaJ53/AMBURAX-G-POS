import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { gstStateCode } from "@/lib/gstStates";

/**
 * Add another store to a business (screen 70). Owner only. The store joins the business's one
 * Company (ADR-077: extra stores are extra Warehouses in the same Company, never a second site), and
 * its ERPNext warehouse is created by the store sync — at once if the business is connected, or
 * when it connects.
 */

export type AddStoreInput = {
  actor: { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };
  name: string;
  code: string;
  storeType?: "RETAIL" | "WAREHOUSE";
  phone?: string | null;
  addressLine: string;
  city: string;
  state: string;
  postalCode?: string | null;
};

export type AddStoreResult =
  | { status: "ok"; storeId: string }
  | { status: "forbidden" }
  | { status: "conflict"; reason: string }
  | { status: "validation_error"; field: string; reason: string };

const CODE = /^[A-Z0-9]{2,10}$/;

export async function addStore(input: AddStoreInput): Promise<AddStoreResult> {
  if (input.actor.tenantRole !== "OWNER") return { status: "forbidden" };
  const name = input.name.trim().replace(/\s+/g, " ");
  const code = input.code.trim().toUpperCase();
  const addressLine = input.addressLine.trim();
  const city = input.city.trim();
  const state = input.state.trim();
  const postalCode = input.postalCode?.trim() || null;
  if (name.length < 2 || name.length > 80) return { status: "validation_error", field: "name", reason: "Enter a store name (2-80 characters)." };
  if (!CODE.test(code)) return { status: "validation_error", field: "code", reason: "A store code is 2-10 letters or digits, like MAIN or SURAT2." };
  if (addressLine.length < 3) return { status: "validation_error", field: "addressLine", reason: "Enter the street address." };
  if (city.length < 2) return { status: "validation_error", field: "city", reason: "Enter the city." };
  // The state decides CGST+SGST vs IGST on purchases, so it must be a real Indian state.
  if (!gstStateCode(state)) return { status: "validation_error", field: "state", reason: "Choose the store's state." };
  if (postalCode && !/^\d{6}$/.test(postalCode)) return { status: "validation_error", field: "postalCode", reason: "A PIN code is 6 digits." };

  const company = await db.company.findFirst({
    where: { tenantId: input.actor.tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true, currency: true },
  });
  const correlationId = randomUUID();
  try {
    const store = await db.$transaction(async (tx) => {
      const created = await tx.store.create({
        data: {
          tenantId: input.actor.tenantId,
          name,
          code,
          storeType: input.storeType ?? "RETAIL",
          currency: company?.currency ?? "INR",
          phone: input.phone?.trim() || null,
          addressLine,
          city,
          state,
          postalCode,
          isDefault: false,
          companyId: company?.id ?? null,
        },
        select: { id: true },
      });
      await tx.storeMembership.create({
        data: { tenantId: input.actor.tenantId, userId: input.actor.userId, storeId: created.id, role: "OWNER" },
      });
      await enqueueOutboxEvent(tx, {
        tenantId: input.actor.tenantId,
        storeId: created.id,
        eventType: "StoreCreated",
        actorUserId: input.actor.userId,
        correlationId,
        entityId: created.id,
        payload: {},
      });
      await writeAuditLogTx(tx, {
        tenantId: input.actor.tenantId,
        userId: input.actor.userId,
        action: "StoreAdded",
        correlationId,
        metadata: { storeId: created.id, code },
      });
      return created;
    });
    return { status: "ok", storeId: store.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { status: "conflict", reason: `Store code ${code} is already used in this business.` };
    }
    throw err;
  }
}
