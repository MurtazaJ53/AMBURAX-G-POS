import { CustomerType } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { Capability } from "@/server/capability/capabilities";
import { requireCapability } from "@/server/capability/capabilityService";

export { CustomerType };

/**
 * The commercial terms a merchant agrees with a business buyer.
 *
 * ## An extension, not a second customer system
 *
 * There is no `WholesaleCustomer`. A wholesale buyer and a walk-in are the same kind of thing
 * with different commercial terms, and splitting them would leave the platform with two customer
 * records to keep in step — two search paths, two address books, two pricing attachments, and an
 * eventual argument about which one is real. This service reads and writes three fields on the
 * existing `Customer`.
 *
 * ## Configuration, not accounting
 *
 * Everything here is what was *agreed*. Nothing here is what is *owed*.
 *
 * `creditLimitMinor` is stored and never enforced: no order is refused because of it, and no
 * "available credit" is computed anywhere in this system. Computing one would need the
 * outstanding balance, which ERPNext owns and AMBURAX cannot see — so any figure produced here
 * would be invented, and a fabricated credit position is worse than none. Enforcement is W-7 and
 * depends on ERP integration existing first.
 *
 * Likewise `paymentTermsDays` is an agreed period, not a payment schedule. Nothing computes a due
 * date, an ageing bucket or a receivable from it.
 *
 * ## Capability
 *
 * Setting commercial terms is a genuinely wholesale operation and is gated on WHOLESALE at this
 * boundary, so a direct HTTP call is refused exactly as a UI action would be.
 *
 * **Reading or creating a customer is not gated**, and neither is searching one, attaching an
 * address, or assigning a price list. Those are shared foundations retail needs too, and gating
 * them behind WHOLESALE would break a retail-only tenant.
 */

export interface WholesaleActor {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
  membershipRole: string | null;
}

export type CommercialProfileFailure =
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "validation_error"; field: string; reason: string }
  | { status: "capability_disabled"; capability: Capability };

export interface CommercialProfile {
  customerId: string;
  customerType: CustomerType;
  paymentTermsDays: number | null;
  creditLimitMinor: number | null;
}

const PROFILE_SELECT = {
  id: true,
  customerType: true,
  paymentTermsDays: true,
  creditLimitMinor: true,
} as const;

function toProfile(row: {
  id: string;
  customerType: CustomerType;
  paymentTermsDays: number | null;
  creditLimitMinor: number | null;
}): CommercialProfile {
  return {
    customerId: row.id,
    customerType: row.customerType,
    paymentTermsDays: row.paymentTermsDays,
    creditLimitMinor: row.creditLimitMinor,
  };
}

/**
 * A year. Beyond this a "credit period" is not a trading term but a typo — and a due date a year
 * out is indistinguishable from never.
 */
export const MAX_PAYMENT_TERMS_DAYS = 365;

/** Ten crore in minor units. A guard against fat fingers, not a business rule about size. */
export const MAX_CREDIT_LIMIT_MINOR = 10_000_000_000;

export type SetCommercialProfileResult =
  | { status: "ok"; profile: CommercialProfile }
  | CommercialProfileFailure;

/**
 * Record the terms agreed with a buyer.
 *
 * Every field is optional and omitting one leaves it untouched, so setting a credit limit does
 * not silently clear the payment terms beside it. Passing `null` explicitly clears a field —
 * distinguishable from omission, because "we no longer extend credit" and "I did not mention
 * credit" are different statements.
 */
export async function setCommercialProfile(params: {
  actor: WholesaleActor;
  customerId: string;
  customerType?: CustomerType;
  paymentTermsDays?: number | null;
  creditLimitMinor?: number | null;
  correlationId: string;
}): Promise<SetCommercialProfileResult> {
  const { tenantId } = params.actor;

  const gate = await requireCapability(tenantId, Capability.WHOLESALE);
  if (gate.status !== "ok") {
    return { status: "capability_disabled", capability: gate.capability };
  }

  // Commercial terms are a tenant-wide commitment about money, not a till operation. The
  // tenant-wide role decides, the same rule capability configuration itself uses.
  if (params.actor.tenantRole !== "OWNER") return { status: "forbidden" };

  if (params.paymentTermsDays !== undefined && params.paymentTermsDays !== null) {
    const days = params.paymentTermsDays;
    if (!Number.isInteger(days) || days < 0) {
      return {
        status: "validation_error",
        field: "paymentTermsDays",
        reason: "Enter a whole number of days, or leave it blank.",
      };
    }
    if (days > MAX_PAYMENT_TERMS_DAYS) {
      return {
        status: "validation_error",
        field: "paymentTermsDays",
        reason: `Credit periods longer than ${MAX_PAYMENT_TERMS_DAYS} days are not accepted.`,
      };
    }
  }

  if (params.creditLimitMinor !== undefined && params.creditLimitMinor !== null) {
    const limit = params.creditLimitMinor;
    // Integer minor units, like every other money value here. Zero is meaningful — it says
    // "this buyer gets no credit", which is different from "no limit was agreed".
    if (!Number.isInteger(limit) || limit < 0) {
      return {
        status: "validation_error",
        field: "creditLimitMinor",
        reason: "Enter a whole amount of at least zero, or leave it blank.",
      };
    }
    if (limit > MAX_CREDIT_LIMIT_MINOR) {
      return {
        status: "validation_error",
        field: "creditLimitMinor",
        reason: "That credit limit is implausibly large.",
      };
    }
  }

  // Tenant-scoped, so another tenant's customer is indistinguishable from one that does not
  // exist — no cross-tenant existence oracle.
  const customer = await db.customer.findFirst({
    where: { id: params.customerId, tenantId },
    select: { id: true },
  });
  if (!customer) return { status: "not_found" };

  const updated = await db.customer.update({
    where: { id: customer.id },
    data: {
      ...(params.customerType !== undefined ? { customerType: params.customerType } : {}),
      ...(params.paymentTermsDays !== undefined
        ? { paymentTermsDays: params.paymentTermsDays }
        : {}),
      ...(params.creditLimitMinor !== undefined
        ? { creditLimitMinor: params.creditLimitMinor }
        : {}),
    },
    select: PROFILE_SELECT,
  });

  await writeAuditLog({
    tenantId,
    userId: params.actor.userId,
    action: "CustomerCommercialProfileSet",
    correlationId: params.correlationId,
    metadata: {
      customerId: customer.id,
      customerType: updated.customerType,
      paymentTermsDays: updated.paymentTermsDays,
      creditLimitMinor: updated.creditLimitMinor,
    },
  });

  return { status: "ok", profile: toProfile(updated) };
}

export type GetCommercialProfileResult =
  | { status: "ok"; profile: CommercialProfile }
  | CommercialProfileFailure;

/**
 * Read the terms agreed with a buyer.
 *
 * Gated on WHOLESALE like the write. Commercial terms are wholesale information: a retail-only
 * tenant has none, and exposing the shape of a credit arrangement to a capability that does not
 * trade on credit serves nobody.
 *
 * Note what this deliberately does not return: any balance, utilisation or availability. No such
 * number exists in this system, and inventing a field for one would invite a screen to display
 * it.
 */
export async function getCommercialProfile(params: {
  actor: WholesaleActor;
  customerId: string;
}): Promise<GetCommercialProfileResult> {
  const { tenantId } = params.actor;

  const gate = await requireCapability(tenantId, Capability.WHOLESALE);
  if (gate.status !== "ok") {
    return { status: "capability_disabled", capability: gate.capability };
  }

  const customer = await db.customer.findFirst({
    where: { id: params.customerId, tenantId },
    select: PROFILE_SELECT,
  });
  if (!customer) return { status: "not_found" };

  return { status: "ok", profile: toProfile(customer) };
}
