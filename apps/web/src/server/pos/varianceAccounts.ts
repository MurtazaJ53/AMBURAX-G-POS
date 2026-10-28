import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { canManageCredit } from "@/server/khata/customerCreditOverride";

/**
 * E4 (owner 2026-10-14): finance names the ERPNext cash account and cash over/short account for the
 * store's Company. AMBURAX never chooses them. Saving them (owner or accountant, with a reason, audited
 * old -> new) re-queues every approved difference that was waiting, so nothing is forgotten.
 */

type Actor = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF"; storeId: string };

async function companyOf(actor: Actor) {
  const store = await db.store.findFirst({ where: { id: actor.storeId, tenantId: actor.tenantId }, select: { companyId: true } });
  if (!store?.companyId) return null;
  return db.company.findFirst({
    where: { id: store.companyId, tenantId: actor.tenantId },
    select: { id: true, name: true, erpCashAccount: true, erpCashOverShortAccount: true },
  });
}

export async function getVarianceAccounts(actor: Actor) {
  if (!(await canManageCredit(actor))) return { status: "forbidden" as const };
  const company = await companyOf(actor);
  if (!company) return { status: "company_unavailable" as const };
  const waiting = await db.posSession.count({
    where: { tenantId: actor.tenantId, store: { companyId: company.id }, variancePostingStatus: "AWAITING_ACCOUNT_MAPPING" },
  });
  return { status: "ok" as const, company, waiting };
}

/** ERPNext Account names are Data fields (140 chars), e.g. "Cash - AR". */
const clean = (v: string) => v.trim().replace(/\s+/g, " ");

export async function setVarianceAccounts(input: {
  actor: Actor;
  cashAccount: string;
  overShortAccount: string;
  reason: string;
}): Promise<
  | { status: "ok"; requeued: number }
  | { status: "forbidden" }
  | { status: "company_unavailable" }
  | { status: "validation_error"; reason: string }
> {
  if (!(await canManageCredit(input.actor))) return { status: "forbidden" };
  const cash = clean(input.cashAccount);
  const overShort = clean(input.overShortAccount);
  const reason = clean(input.reason);
  if (cash.length < 2 || cash.length > 140 || overShort.length < 2 || overShort.length > 140) {
    return { status: "validation_error", reason: "Enter both account names exactly as they appear in accounting." };
  }
  if (cash === overShort) return { status: "validation_error", reason: "The cash and over/short accounts must be different." };
  if (reason.length < 3 || reason.length > 200) return { status: "validation_error", reason: "Give a reason for the change." };
  const company = await companyOf(input.actor);
  if (!company) return { status: "company_unavailable" };

  const correlationId = randomUUID();
  const requeued = await db.$transaction(async (tx) => {
    await tx.company.update({ where: { id: company.id }, data: { erpCashAccount: cash, erpCashOverShortAccount: overShort } });
    await writeAuditLogTx(tx, {
      tenantId: input.actor.tenantId,
      userId: input.actor.userId,
      action: "CompanyVarianceAccountsSet",
      correlationId,
      metadata: {
        companyId: company.id,
        reason,
        before: { cash: company.erpCashAccount, overShort: company.erpCashOverShortAccount },
        after: { cash, overShort },
      },
    });
    const waiting = await tx.posSession.findMany({
      where: { tenantId: input.actor.tenantId, store: { companyId: company.id }, variancePostingStatus: "AWAITING_ACCOUNT_MAPPING" },
      select: { id: true, storeId: true },
    });
    for (const s of waiting) {
      await enqueueOutboxEvent(tx, {
        tenantId: input.actor.tenantId,
        storeId: s.storeId,
        eventType: "TillVarianceApproved",
        entityId: s.id,
        correlationId,
        actorUserId: input.actor.userId,
        payload: { sessionId: s.id },
        discriminator: correlationId,
      });
    }
    return waiting.length;
  });
  return { status: "ok", requeued };
}
