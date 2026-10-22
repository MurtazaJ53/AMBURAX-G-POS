import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";
import { STORE_SCOPE_SELECT, storeScopeOf } from "@/server/sales/storeScope";
import { findOrCreateCreditAccount } from "./creditAccount";
import { resolveCreditMode, validateCreditMode, type CreditModeValue } from "./creditMode";

/**
 * Owner-only Udhar mode override for one customer's company-scoped credit account.
 *
 * Tenant, user, role and Store come from the session; the Company and currency come only from the
 * persisted Store (`storeScopeOf`). The client supplies the customer id and the desired mode, never
 * a scope. The override touches exactly one CustomerCreditAccount: never the Company default and
 * never another customer. The legacy tenant-wide `Customer.creditLimitMinor` is not read.
 *
 * Q5/Q10 (owner 2026-10-14): the owner or the accountant (the finance role) may set it, always with a
 * reason; every change is audited with the old and new values. The till only accepts LIMITED with a
 * positive limit, so a new account (BLOCKED, Rs 0) gives no credit until someone sets one.
 */

/** Who may change a customer's credit: the owner, or an accountant of the current store. */
export async function canManageCredit(actor: { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF"; storeId: string }) {
  if (actor.tenantRole === "OWNER") return true;
  const m = await db.storeMembership.findFirst({
    where: { tenantId: actor.tenantId, userId: actor.userId, storeId: actor.storeId },
    select: { role: true },
  });
  return m?.role === "ACCOUNTANT";
}

function cleanReason(raw: unknown): string | null {
  const r = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  return r.length >= 3 && r.length <= 200 ? r : null;
}

export interface CustomerCreditActor {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
  storeId: string;
}

export type CreditModeSourceValue = "COMPANY_DEFAULT" | "OWNER_OVERRIDE" | "MIGRATED";

export interface CustomerCreditModeView {
  companyId: string;
  companyName: string;
  currency: string;
  /** False when the customer has no account yet; the mode shown is then the BLOCKED fallback. */
  accountExists: boolean;
  mode: CreditModeValue;
  limitMinor: number | null;
  source: CreditModeSourceValue | null;
  setAt: Date | null;
  /** What a new account would inherit right now. */
  companyDefault: { mode: CreditModeValue; limitMinor: number | null };
  /** An administrative hold stops new udhar whatever the mode. */
  hold: boolean;
}

export type CustomerCreditModeResult =
  | { status: "ok"; view: CustomerCreditModeView; changed?: boolean }
  | { status: "forbidden" }
  | { status: "company_unavailable" }
  | { status: "not_found" }
  | { status: "validation_error"; reason: string };

type Client = typeof db | Prisma.TransactionClient;

async function scopeFor(client: Client, actor: CustomerCreditActor) {
  const store = await client.store.findFirst({
    where: { id: actor.storeId, tenantId: actor.tenantId },
    select: STORE_SCOPE_SELECT,
  });
  const scope = store ? storeScopeOf(store) : null;
  if (!scope) return null;
  const company = await client.company.findUnique({
    where: { id_tenantId: { id: scope.companyId, tenantId: actor.tenantId } },
    select: { id: true, name: true, currency: true, defaultCreditMode: true, defaultCreditLimitMinor: true },
  });
  return company;
}

function viewOf(
  company: { id: string; name: string; currency: string; defaultCreditMode: string; defaultCreditLimitMinor: number | null },
  account: { creditMode: string; creditModeLimitMinor: number | null; creditModeSource: string; creditModeSetAt: Date; creditHold: boolean } | null,
): CustomerCreditModeView {
  const effective = account
    ? resolveCreditMode({ mode: account.creditMode, limitMinor: account.creditModeLimitMinor })
    : resolveCreditMode(null);
  const companyDefault = resolveCreditMode({ mode: company.defaultCreditMode, limitMinor: company.defaultCreditLimitMinor });
  return {
    companyId: company.id,
    companyName: company.name,
    currency: company.currency,
    accountExists: account !== null,
    mode: effective.mode,
    limitMinor: effective.limitMinor,
    source: account ? (account.creditModeSource as CreditModeSourceValue) : null,
    setAt: account ? account.creditModeSetAt : null,
    companyDefault,
    hold: account?.creditHold ?? false,
  };
}

const ACCOUNT_SELECT = {
  id: true,
  creditMode: true,
  creditModeLimitMinor: true,
  creditModeSource: true,
  creditModeSetAt: true,
  creditHold: true,
} as const;

/** Read-only: never creates an account. */
export async function getCustomerCreditMode(params: {
  actor: CustomerCreditActor;
  customerId: string;
}): Promise<CustomerCreditModeResult> {
  if (!(await canManageCredit(params.actor))) return { status: "forbidden" };
  const company = await scopeFor(db, params.actor);
  if (!company) return { status: "company_unavailable" };

  const customer = await db.customer.findFirst({
    where: { id: params.customerId, tenantId: params.actor.tenantId },
    select: { id: true },
  });
  if (!customer) return { status: "not_found" };

  const account = await db.customerCreditAccount.findUnique({
    where: {
      tenantId_companyId_customerId: { tenantId: params.actor.tenantId, companyId: company.id, customerId: customer.id },
    },
    select: ACCOUNT_SELECT,
  });
  return { status: "ok", view: viewOf(company, account) };
}

export async function setCustomerCreditMode(params: {
  actor: CustomerCreditActor;
  customerId: string;
  mode: unknown;
  limitMinor: unknown;
  /** Required (Q10): why the credit is being changed. */
  reason: unknown;
  correlationId: string;
}): Promise<CustomerCreditModeResult> {
  if (!(await canManageCredit(params.actor))) return { status: "forbidden" };
  const reason = cleanReason(params.reason);
  if (!reason) return { status: "validation_error", reason: "Give a reason for the change (3 to 200 characters)." };
  const validation = validateCreditMode(params.mode, params.limitMinor);
  if (!validation.ok) return { status: "validation_error", reason: validation.reason };
  const next = validation.config;

  return db.$transaction(async (tx) => {
    const company = await scopeFor(tx, params.actor);
    if (!company) return { status: "company_unavailable" } as const;

    // Tenant-scoped lookup: another tenant's customer is indistinguishable from a missing one, and
    // no account is ever created for it.
    const customer = await tx.customer.findFirst({
      where: { id: params.customerId, tenantId: params.actor.tenantId },
      select: { id: true },
    });
    if (!customer) return { status: "not_found" } as const;

    // An account that does not exist yet first inherits the Company default, then the override
    // below replaces it, all in this transaction.
    const created = await findOrCreateCreditAccount(tx, {
      tenantId: params.actor.tenantId,
      companyId: company.id,
      customerId: customer.id,
    });

    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "customer_credit_accounts"
      WHERE "id" = ${created.id} AND "tenantId" = ${params.actor.tenantId} AND "companyId" = ${company.id}
      FOR UPDATE
    `;
    if (locked.length === 0) return { status: "not_found" } as const;

    // Re-read under the lock so the audit "before" is never stale.
    const before = await tx.customerCreditAccount.findUniqueOrThrow({ where: { id: created.id }, select: ACCOUNT_SELECT });

    const changed =
      before.creditMode !== next.mode ||
      before.creditModeLimitMinor !== next.limitMinor ||
      before.creditModeSource !== "OWNER_OVERRIDE";

    const after = changed
      ? await tx.customerCreditAccount.update({
          where: { id: created.id },
          data: {
            creditMode: next.mode,
            creditModeLimitMinor: next.limitMinor,
            creditModeSource: "OWNER_OVERRIDE",
            creditModeSetAt: new Date(),
          },
          select: ACCOUNT_SELECT,
        })
      : before;

    if (changed) {
      await writeAuditLogTx(tx, {
        tenantId: params.actor.tenantId,
        userId: params.actor.userId,
        action: "CustomerCreditModeOverridden",
        correlationId: params.correlationId,
        metadata: {
          customerId: customer.id,
          companyId: company.id,
          creditAccountId: created.id,
          reason,
          before: { mode: before.creditMode, limitMinor: before.creditModeLimitMinor, source: before.creditModeSource },
          after: { mode: after.creditMode, limitMinor: after.creditModeLimitMinor, source: after.creditModeSource },
        },
      });
    }

    return { status: "ok", view: viewOf(company, after), changed } as const;
  });
}

/** Put a customer's udhar on hold, or lift the hold (Q5/Q10). Collections and returns stay open. */
export async function setCustomerCreditHold(params: {
  actor: CustomerCreditActor;
  customerId: string;
  hold: boolean;
  reason: unknown;
  correlationId: string;
}): Promise<CustomerCreditModeResult> {
  if (!(await canManageCredit(params.actor))) return { status: "forbidden" };
  const reason = cleanReason(params.reason);
  if (!reason) return { status: "validation_error", reason: "Give a reason for the change (3 to 200 characters)." };
  return db.$transaction(async (tx) => {
    const company = await scopeFor(tx, params.actor);
    if (!company) return { status: "company_unavailable" } as const;
    const customer = await tx.customer.findFirst({
      where: { id: params.customerId, tenantId: params.actor.tenantId },
      select: { id: true },
    });
    if (!customer) return { status: "not_found" } as const;
    const account = await findOrCreateCreditAccount(tx, {
      tenantId: params.actor.tenantId,
      companyId: company.id,
      customerId: customer.id,
    });
    await tx.$queryRaw`SELECT "id" FROM "customer_credit_accounts" WHERE "id" = ${account.id} FOR UPDATE`;
    const before = await tx.customerCreditAccount.findUniqueOrThrow({ where: { id: account.id }, select: ACCOUNT_SELECT });
    const changed = before.creditHold !== params.hold;
    const after = changed
      ? await tx.customerCreditAccount.update({ where: { id: account.id }, data: { creditHold: params.hold }, select: ACCOUNT_SELECT })
      : before;
    if (changed) {
      await writeAuditLogTx(tx, {
        tenantId: params.actor.tenantId,
        userId: params.actor.userId,
        action: params.hold ? "CustomerCreditHeld" : "CustomerCreditHoldLifted",
        correlationId: params.correlationId,
        metadata: { customerId: customer.id, companyId: company.id, creditAccountId: account.id, reason },
      });
    }
    return { status: "ok", view: viewOf(company, after), changed } as const;
  });
}

