import { db } from "@/server/db";
import type { ErpClient } from "@/server/erp/client";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport } from "@/server/erp/transport";
import { createDocument, erpDate, findDocumentName, newErpClient, requireErpEnvironment } from "@/server/erp/documentSync";

const STAMP = "amburax-till-variance:";

/**
 * E4 (owner 2026-10-14): an approved till CASH difference becomes one submitted ERPNext Journal Entry
 * between the store Company's cash account and its cash over/short account, both supplied by finance
 * (Company.erpCashAccount / erpCashOverShortAccount). Nothing is posted until both are set; the shift
 * then says "awaiting account mapping". A short drawer debits over/short and credits cash; an excess
 * does the reverse. UPI and card differences are reconciliation items, not cash, and are not posted.
 *
 * Marked POSTED only after ERPNext confirms. Idempotent through the `user_remark` stamp.
 */
export class ErpTillVarianceAdapter {
  private client: ErpClient;

  constructor(transport?: ErpTransport) {
    this.client = newErpClient(transport);
  }

  public async syncVariance(tenantId: string, sessionId: string, correlationId: string): Promise<string | null> {
    const session = await db.posSession.findFirst({
      where: { id: sessionId, tenantId },
      select: {
        id: true,
        closedAt: true,
        varianceStatus: true,
        variancePostingStatus: true,
        varianceErpRef: true,
        counts: { where: { method: "CASH" }, select: { differenceMinor: true } },
        store: { select: { company: { select: { erpCashAccount: true, erpCashOverShortAccount: true } } } },
      },
    });
    if (!session) throw new Error(`Shift ${sessionId} not found for tenant ${tenantId}`);
    if (session.varianceStatus !== "APPROVED") return null;
    if (session.variancePostingStatus === "POSTED") return session.varianceErpRef;

    const diff = session.counts[0]?.differenceMinor ?? 0;
    if (diff === 0) {
      await this.mark(tenantId, sessionId, { variancePostingStatus: "NOTHING_TO_POST" });
      return null;
    }
    const cash = session.store.company?.erpCashAccount ?? null;
    const overShort = session.store.company?.erpCashOverShortAccount ?? null;
    if (!cash || !overShort) {
      await this.mark(tenantId, sessionId, { variancePostingStatus: "AWAITING_ACCOUNT_MAPPING" });
      return null;
    }

    try {
      const env = await requireErpEnvironment(tenantId, correlationId);
      const ctx = { tenantId, correlationId, causationId: sessionId };
      const stamp = `${STAMP}${sessionId}`;
      let name = await findDocumentName(this.client, env, ctx, "Journal Entry", "user_remark", stamp);
      if (!name) {
        // The Journal Entry's company is the one that owns the cash account.
        const acct = await this.client.call(env, ctx, { method: "GET", path: `/api/resource/Account/${encodeURIComponent(cash)}` });
        const company = (acct.body as { data?: { company?: string } })?.data?.company;
        if (!company) {
          throw new ErpError({ kind: "configuration_error", message: `ERPNext has no account named ${cash}.`, correlationId });
        }
        const amount = Math.abs(diff) / 100;
        const short = diff < 0;
        name = await createDocument(
          this.client,
          env,
          ctx,
          "Journal Entry",
          {
            voucher_type: "Journal Entry",
            company,
            posting_date: erpDate(session.closedAt ?? new Date()),
            user_remark: stamp,
            accounts: [
              { account: overShort, debit_in_account_currency: short ? amount : 0, credit_in_account_currency: short ? 0 : amount },
              { account: cash, debit_in_account_currency: short ? 0 : amount, credit_in_account_currency: short ? amount : 0 },
            ],
          },
          `till-variance:${sessionId}`,
          true,
        );
      }
      await this.mark(tenantId, sessionId, { variancePostingStatus: "POSTED", varianceErpRef: name });
      return name;
    } catch (error) {
      await this.mark(tenantId, sessionId, { variancePostingStatus: "FAILED" });
      throw error;
    }
  }

  private async mark(tenantId: string, sessionId: string, data: { variancePostingStatus: string; varianceErpRef?: string }) {
    await db.posSession.updateMany({ where: { id: sessionId, tenantId }, data });
  }
}
