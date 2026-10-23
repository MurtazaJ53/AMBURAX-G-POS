import { ErpClient, type ErpCallContext } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider, type ErpEnvironment } from "@/server/erp/config";
import { ErpError } from "@/server/erp/errors";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import type { ErpTransport } from "@/server/erp/transport";

/** The Modes of Payment that settle into a bank, which provisioning points at a placeholder. */
export const BANK_MODES = ["UPI", "Credit Card"] as const;

/**
 * Whether the owner has replaced the "Bank - {abbr}" placeholder that provisioning creates.
 *
 *   linked      — every bank mode names a valid leaf bank account of this company other than the placeholder.
 *   placeholder — at least one bank mode still points at the placeholder (or at nothing valid).
 *   unknown     — not connected to ERPNext yet. Not a claim either way.
 */
export type BankLinkStatus = "linked" | "placeholder" | "unknown";

export class ErpBankLinkReader {
  private client: ErpClient;

  constructor(transport?: ErpTransport) {
    this.client = new ErpClient(transport ?? new HttpErpTransport(), new EnvErpCredentialProvider(), {});
  }

  async getBankLinkStatus(tenantId: string, correlationId: string): Promise<BankLinkStatus> {
    const envResult = await resolveErpEnvironment(tenantId);
    if (envResult.status !== "ok" || !envResult.environment.companyId) return "unknown";
    const env = envResult.environment;
    const company = env.companyId!;
    const ctx: ErpCallContext = { tenantId, correlationId, causationId: tenantId };

    const companyDoc = (await this.get(env, ctx, `/api/resource/Company/${encodeURIComponent(company)}`)) as
      | { abbr?: string }
      | null;
    if (!companyDoc?.abbr) return "unknown";
    const placeholder = `Bank - ${companyDoc.abbr}`;

    for (const mode of BANK_MODES) {
      const doc = (await this.get(env, ctx, `/api/resource/Mode of Payment/${encodeURIComponent(mode)}`)) as
        | { accounts?: Array<{ company: string; default_account?: string }> }
        | null;
      const account = doc?.accounts?.find((a) => a.company === company)?.default_account;
      if (!account || account === placeholder) return "placeholder";
      const accountDoc = (await this.get(env, ctx, `/api/resource/Account/${encodeURIComponent(account)}`)) as
        | { company?: string; is_group?: number | boolean; account_type?: string }
        | null;
      if (!accountDoc || accountDoc.is_group || accountDoc.company !== company || accountDoc.account_type !== "Bank") {
        return "placeholder";
      }
    }
    return "linked";
  }

  /** A document's `data`, or null when ERPNext says it does not exist. */
  private async get(env: ErpEnvironment, ctx: ErpCallContext, path: string): Promise<unknown> {
    try {
      return ((await this.client.call(env, ctx, { method: "GET", path })).body as { data?: unknown })?.data ?? null;
    } catch (error) {
      if (error instanceof ErpError && error.kind === "not_found") return null;
      throw error;
    }
  }
}
