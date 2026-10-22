import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { resolveCreditMode } from "./creditMode";

/**
 * Find or create a customer's company-scoped credit account.
 *
 * A new account copies the Company's current default credit mode and limit, resolved through
 * `resolveCreditMode` so an invalid default is stored as BLOCKED. An existing account is returned
 * unchanged: a later change to the Company default never rewrites it.
 *
 * Not wired into checkout or payments yet. Takes the caller's transaction so creation commits
 * with whatever the caller is doing.
 */
export async function findOrCreateCreditAccount(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; companyId: string; customerId: string },
) {
  const key = { tenantId: params.tenantId, companyId: params.companyId, customerId: params.customerId };
  const existing = await tx.customerCreditAccount.findUnique({ where: { tenantId_companyId_customerId: key } });
  if (existing) return existing;

  const company = await tx.company.findUnique({
    where: { id_tenantId: { id: params.companyId, tenantId: params.tenantId } },
    select: { currency: true, defaultCreditMode: true, defaultCreditLimitMinor: true },
  });
  if (!company) throw new Error(`Company ${params.companyId} not found for tenant ${params.tenantId}`);

  const inherited = resolveCreditMode({ mode: company.defaultCreditMode, limitMinor: company.defaultCreditLimitMinor });

  // A concurrent creator can win the unique (tenant, company, customer) key; its row is then the
  // account. ON CONFLICT DO NOTHING keeps the transaction usable where a failed INSERT would abort
  // it. The composite customer foreign key rejects a customer from another tenant.
  await tx.$executeRaw`
    INSERT INTO "customer_credit_accounts"
      ("id", "tenantId", "companyId", "customerId", "currency",
       "creditMode", "creditModeLimitMinor", "creditModeSource", "creditModeSetAt", "updatedAt")
    VALUES
      (${`cca_${randomUUID().replace(/-/g, "")}`}, ${params.tenantId}, ${params.companyId}, ${params.customerId},
       ${company.currency}, ${inherited.mode}::"CreditMode", ${inherited.limitMinor},
       'COMPANY_DEFAULT'::"CreditModeSource", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("tenantId", "companyId", "customerId") DO NOTHING
  `;

  return tx.customerCreditAccount.findUniqueOrThrow({ where: { tenantId_companyId_customerId: key } });
}
