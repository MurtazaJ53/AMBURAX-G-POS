import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";
import { validateCreditMode, type CreditModeValue } from "./creditMode";

export interface CompanyCreditSettingsActor {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
  storeId: string;
}

export type CompanyCreditSettingsResult =
  | { status: "ok"; companyId: string; companyName: string; currency: string; mode: CreditModeValue; limitMinor: number | null; changed?: boolean }
  | { status: "forbidden" }
  | { status: "company_unavailable" }
  | { status: "not_found" }
  | { status: "validation_error"; reason: string };

async function companyForStore(
  client: Pick<typeof db, "store" | "company"> | Prisma.TransactionClient,
  actor: CompanyCreditSettingsActor,
) {
  const store = await client.store.findFirst({
    where: { id: actor.storeId, tenantId: actor.tenantId },
    select: { companyId: true },
  });
  if (!store?.companyId) return null;

  return client.company.findUnique({
    where: { id_tenantId: { id: store.companyId, tenantId: actor.tenantId } },
    select: {
      id: true,
      name: true,
      currency: true,
      defaultCreditMode: true,
      defaultCreditLimitMinor: true,
    },
  });
}

export async function getCompanyCreditDefault(
  actor: CompanyCreditSettingsActor,
): Promise<CompanyCreditSettingsResult> {
  if (actor.tenantRole !== "OWNER") return { status: "forbidden" };
  const company = await companyForStore(db, actor);
  if (!company) return { status: "company_unavailable" };

  const resolved = validateCreditMode(company.defaultCreditMode, company.defaultCreditLimitMinor);
  const config = resolved.ok ? resolved.config : { mode: "BLOCKED" as const, limitMinor: null };
  return {
    status: "ok",
    companyId: company.id,
    companyName: company.name,
    currency: company.currency,
    mode: config.mode,
    limitMinor: config.limitMinor,
  };
}

export async function setCompanyCreditDefault(params: {
  actor: CompanyCreditSettingsActor;
  mode: unknown;
  limitMinor: unknown;
  correlationId: string;
}): Promise<CompanyCreditSettingsResult> {
  if (params.actor.tenantRole !== "OWNER") return { status: "forbidden" };
  const validation = validateCreditMode(params.mode, params.limitMinor);
  if (!validation.ok) return { status: "validation_error", reason: validation.reason };

  return db.$transaction(async (tx) => {
    // Resolve the Company only through the session's Store, inside the same transaction as the
    // update. A caller cannot select a different company by posting an identifier.
    const company = await companyForStore(tx, params.actor);
    if (!company) return { status: "company_unavailable" } as const;

    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "companies"
      WHERE "id" = ${company.id} AND "tenantId" = ${params.actor.tenantId}
      FOR UPDATE
    `;
    if (locked.length === 0) return { status: "not_found" } as const;

    // Re-read after the lock so concurrent owner updates cannot produce a stale before-value
    // in the audit record or in the response.
    const current = await tx.company.findUnique({
      where: { id_tenantId: { id: company.id, tenantId: params.actor.tenantId } },
      select: {
        id: true,
        name: true,
        currency: true,
        defaultCreditMode: true,
        defaultCreditLimitMinor: true,
      },
    });
    if (!current) return { status: "not_found" } as const;

    const before = {
      mode: current.defaultCreditMode,
      limitMinor: current.defaultCreditLimitMinor,
    };
    const next = validation.config;
    const changed = before.mode !== next.mode || before.limitMinor !== next.limitMinor;

    const after = changed
      ? await tx.company.update({
          where: { id_tenantId: { id: company.id, tenantId: params.actor.tenantId } },
          data: {
            defaultCreditMode: next.mode,
            defaultCreditLimitMinor: next.limitMinor,
          },
          select: { defaultCreditMode: true, defaultCreditLimitMinor: true },
        })
      : { defaultCreditMode: before.mode, defaultCreditLimitMinor: before.limitMinor };

    if (changed) {
      await writeAuditLogTx(tx, {
        tenantId: params.actor.tenantId,
        userId: params.actor.userId,
        action: "CompanyCreditDefaultUpdated",
        correlationId: params.correlationId,
        metadata: {
          companyId: company.id,
          before: { mode: before.mode, limitMinor: before.limitMinor },
          after: { mode: after.defaultCreditMode, limitMinor: after.defaultCreditLimitMinor },
        },
      });
    }

    // Deliberately update only Company defaults. Existing customer accounts are frozen snapshots.
    return {
      status: "ok",
      companyId: company.id,
      companyName: current.name,
      currency: current.currency,
      mode: after.defaultCreditMode,
      limitMinor: after.defaultCreditLimitMinor,
      changed,
    } as const;
  });
}
