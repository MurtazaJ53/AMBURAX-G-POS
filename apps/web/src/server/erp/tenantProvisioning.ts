import { logError } from "@/lib/safeLog";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { ErpClient, type ErpCallContext } from "@/server/erp/client";
import { EnvErpCredentialProvider, type ErpEnvironment } from "@/server/erp/config";
import { ErpError } from "@/server/erp/errors";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import type { ErpTransport } from "@/server/erp/transport";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { writeAuditLog } from "@/server/identity/audit";

/**
 * Connect a business to ERPNext (ADR-077: Tenant 1:1 site, Tenant 1:1 Company, Store 1:1 Warehouse).
 *
 * Runs from the outbox (event TenantProvisionRequested), queued at sign-up and by the owner's
 * "Connect to ERPNext" button. Every step is safe to repeat:
 *   1. site      — a SiteProvisioner: a shared dev site now; Frappe Cloud once its API is approved
 *   2. Company   — INR / India; GSTIN only when the business has one. Found by name only if it carries
 *                  this business's marker; a same-named company without it is never taken over.
 *   3. AMBURAX   — the business's Company record, and every unlinked store linked to it
 *   4. stores    — each store queued again, so the store sync makes its Warehouse in this Company
 */

export const TENANT_PROVISION_EVENT = "TenantProvisionRequested";
const CURRENCY = "INR";
const COUNTRY = "India";
/** Stamped on the ERPNext Company so a retry recognises its own, and never someone else's. */
export const companyMarker = (tenantId: string) => `amburax-tenant:${tenantId}`;

// ---------------------------------------------------------------------------- site provisioners

export type SiteResult =
  | { status: "ready"; siteId: string }
  | { status: "pending" }
  | { status: "not_configured"; reason: string };

export interface SiteProvisioner {
  readonly kind: string;
  ensureSite(tenant: { id: string; slug: string }): Promise<SiteResult>;
}

/**
 * Development: every business shares one existing dev site whose integration keys the server already
 * holds (ERP_DEV_SHARED_SITE). A dev shortcut only — ADR-077 gives each business its own site.
 */
export class DevSharedSiteProvisioner implements SiteProvisioner {
  readonly kind = "dev-shared";
  constructor(private siteId = process.env["ERP_DEV_SHARED_SITE"] ?? "frontend") {}
  async ensureSite(): Promise<SiteResult> {
    if (!this.siteId) return { status: "not_configured", reason: "No development ERPNext site is configured (ERP_DEV_SHARED_SITE)." };
    if (process.env["NODE_ENV"] === "production") {
      return { status: "not_configured", reason: "The shared development site can't be used in production." };
    }
    return { status: "ready", siteId: this.siteId };
  }
}

/**
 * Frappe Cloud: creates a site per business on our private bench. Not built yet — it needs the owner-
 * approved Frappe Cloud API key and the documented site-creation endpoint, which is not guessed.
 */
export class FrappeCloudSiteProvisioner implements SiteProvisioner {
  readonly kind = "frappe-cloud";
  async ensureSite(): Promise<SiteResult> {
    return {
      status: "not_configured",
      reason: "Automatic site creation on Frappe Cloud isn't set up yet. It needs the approved Frappe Cloud API key.",
    };
  }
}

export function defaultSiteProvisioner(): SiteProvisioner {
  return process.env["ERP_PROVISIONER"] === "frappe-cloud" ? new FrappeCloudSiteProvisioner() : new DevSharedSiteProvisioner();
}

// ---------------------------------------------------------------------------- request

type Owner = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };

/** Queue the connection. Owner only; does nothing if connected or already queued. */
export async function requestErpConnection(input: { actor: Owner; correlationId?: string }) {
  if (input.actor.tenantRole !== "OWNER") return { status: "forbidden" as const };
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: input.actor.tenantId },
    select: { erpnextProvisionStatus: true, erpnextCompanyId: true },
  });
  if (tenant.erpnextProvisionStatus === "PROVISIONED" && tenant.erpnextCompanyId) return { status: "already_connected" as const };
  const queued = await db.outboxEvent.count({
    where: { tenantId: input.actor.tenantId, eventType: TENANT_PROVISION_EVENT, publishedAt: null, deadLetteredAt: null },
  });
  if (queued > 0) return { status: "queued" as const };
  const correlationId = input.correlationId ?? randomUUID();
  await db.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: input.actor.tenantId },
      data: { erpnextProvisionStatus: "PROVISIONING", erpnextProvisionError: null },
    });
    await enqueueOutboxEvent(tx, {
      tenantId: input.actor.tenantId,
      eventType: TENANT_PROVISION_EVENT,
      actorUserId: input.actor.userId,
      correlationId,
      entityId: input.actor.tenantId,
      payload: {},
      // A business may need connecting again after a failure: one event per request.
      discriminator: correlationId,
    });
  });
  await writeAuditLog({ tenantId: input.actor.tenantId, userId: input.actor.userId, action: "ErpConnectionRequested", correlationId });
  return { status: "queued" as const };
}

// ---------------------------------------------------------------------------- run

/** Upper-case initials, letters and digits only, at most 5 — ERPNext's company abbreviation. */
export function abbreviationFor(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const initials = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "CO").slice(0, 3);
  return (initials || "CO").slice(0, 5);
}

/** A condition only a person can resolve: recorded for the owner, not retried. */
class ProvisionStop extends Error {}

export class TenantProvisioner {
  private client: ErpClient;

  constructor(
    transport?: ErpTransport,
    private sites: SiteProvisioner = defaultSiteProvisioner(),
  ) {
    this.client = new ErpClient(transport ?? new HttpErpTransport(), new EnvErpCredentialProvider(), {});
  }

  private async get(env: ErpEnvironment, ctx: ErpCallContext, path: string) {
    try {
      return (await this.client.call(env, ctx, { method: "GET", path })).body as { data?: unknown };
    } catch (error) {
      if (error instanceof ErpError && error.kind === "not_found") return null;
      throw error;
    }
  }

  /** True when the backend already has it: a found document, or a non-empty list. */
  private async exists(env: ErpEnvironment, ctx: ErpCallContext, path: string): Promise<boolean> {
    const data = (await this.get(env, ctx, path))?.data;
    return Array.isArray(data) ? data.length > 0 : Boolean(data);
  }

  /** Creates `doctype/name` unless it exists. A refusal is logged and setup carries on. */
  private async ensure(env: ErpEnvironment, ctx: ErpCallContext, doctype: string, name: string, body: Record<string, unknown>) {
    try {
      if (await this.exists(env, ctx, `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)) return true;
      await this.client.call(env, ctx, { method: "POST", path: `/api/resource/${encodeURIComponent(doctype)}`, body });
      return true;
    } catch (err) {
      logError(`provisioning: ${doctype} could not be created`, err, { correlationId: ctx.correlationId, name });
      return false;
    }
  }

  /**
   * Everything a sale or purchase needs before it can post, created only when missing:
   *   - GST accounts under Duties and Taxes (output for sales, input for purchases);
   *   - the In-State / Out-State tax categories and one purchase GST template for each
   *     (CGST + SGST in-state, IGST out-of-state; amounts always come from the bill itself);
   *   - this company's Indian financial year (1 April - 31 March), current and next.
   * A shop without GST never uses the GST pieces: its bills carry no tax rows. If the backend
   * refuses a step (missing permission), connecting still succeeds and the sync names what's missing.
   */
  private async ensureTaxSetup(env: ErpEnvironment, ctx: ErpCallContext, company: string, abbr: string, today = new Date()) {
    const parent_account = `Duties and Taxes - ${abbr}`;
    const account = (head: string) =>
      this.ensure(env, ctx, "Account", `${head} - ${abbr}`, { account_name: head, parent_account, company, account_type: "Tax", is_group: 0 });
    for (const head of ["Output Tax CGST", "Output Tax SGST", "Output Tax IGST", "Input Tax CGST", "Input Tax SGST", "Input Tax IGST"]) {
      await account(head);
    }

    for (const [category, heads] of [
      ["In-State", ["Input Tax CGST", "Input Tax SGST"]],
      ["Out-State", ["Input Tax IGST"]],
    ] as const) {
      if (!(await this.ensure(env, ctx, "Tax Category", category, { title: category }))) continue;
      const title = `GST ${category} Purchase`;
      await this.ensure(env, ctx, "Purchase Taxes and Charges Template", `${title} - ${abbr}`, {
        title,
        company,
        tax_category: category,
        taxes: heads.map((h) => ({ charge_type: "On Net Total", account_head: `${h} - ${abbr}`, description: h, rate: 0 })),
      });
    }

    await this.ensureFiscalYears(env, ctx, company, abbr, today);
    await this.ensureModeOfPaymentSetup(env, ctx, company, abbr);
  }

  /**
   * Ensures a leaf Bank account exists for the company and links:
   *   - Cash -> Cash
   *   - UPI -> Bank
   *   - Credit Card -> Bank
   * in Mode of Payment Account for THIS company only.
   * Idempotent: an existing entry for this company is kept whenever it names a valid leaf
   * account of this company — the owner may have linked their real bank account, and a
   * re-run must never undo that. It is replaced only when that account is missing, a group,
   * or belongs to another company. Never mutates or removes entries for other companies.
   */
  private async ensureModeOfPaymentSetup(env: ErpEnvironment, ctx: ErpCallContext, company: string, abbr: string) {
    const bankAccount = `Bank - ${abbr}`;
    const cashAccount = `Cash - ${abbr}`;
    const bankParent = `Bank Accounts - ${abbr}`;

    // Ensure leaf bank account exists (create one if missing)
    await this.ensure(env, ctx, "Account", bankAccount, {
      account_name: "Bank",
      parent_account: bankParent,
      company,
      account_type: "Bank",
      is_group: 0,
    });

    const mopMappings: Array<{ mode: string; type: "Cash" | "Bank"; defaultAccount: string }> = [
      { mode: "Cash", type: "Cash", defaultAccount: cashAccount },
      { mode: "UPI", type: "Bank", defaultAccount: bankAccount },
      { mode: "Credit Card", type: "Bank", defaultAccount: bankAccount },
    ];

    for (const { mode, type, defaultAccount } of mopMappings) {
      try {
        const existing = await this.get(env, ctx, `/api/resource/Mode of Payment/${encodeURIComponent(mode)}`);
        const doc = existing?.data as { accounts?: Array<{ company: string; default_account: string }> } | undefined;

        if (!doc) {
          await this.client.call(env, ctx, {
            method: "POST",
            path: "/api/resource/Mode of Payment",
            body: {
              doctype: "Mode of Payment",
              mode_of_payment: mode,
              enabled: 1,
              type,
              accounts: [{ company, default_account: defaultAccount }],
            },
          });
        } else {
          const accounts = Array.isArray(doc.accounts) ? [...doc.accounts] : [];
          const idx = accounts.findIndex((a) => a.company === company);
          if (idx !== -1) {
            const current = accounts[idx]?.default_account;
            if (current !== defaultAccount && !(await this.isLeafAccountOf(env, ctx, current, company))) {
              accounts[idx] = { ...accounts[idx], company, default_account: defaultAccount };
              await this.client.call(env, ctx, {
                method: "PUT",
                path: `/api/resource/Mode of Payment/${encodeURIComponent(mode)}`,
                body: { accounts },
              });
            }
          } else {
            accounts.push({ company, default_account: defaultAccount });
            await this.client.call(env, ctx, {
              method: "PUT",
              path: `/api/resource/Mode of Payment/${encodeURIComponent(mode)}`,
              body: { accounts },
            });
          }
        }
      } catch (err) {
        logError(`provisioning: Mode of Payment ${mode} could not be configured`, err, {
          correlationId: ctx.correlationId,
          company,
        });
      }
    }
  }

  /** True when `account` exists, is a ledger (not a group) and belongs to `company`. */
  private async isLeafAccountOf(env: ErpEnvironment, ctx: ErpCallContext, account: string | undefined, company: string) {
    if (!account) return false;
    const doc = (await this.get(env, ctx, `/api/resource/Account/${encodeURIComponent(account)}`))?.data as
      | { company?: string; is_group?: number | boolean }
      | undefined;
    return Boolean(doc) && !doc?.is_group && doc?.company === company;
  }

  /** This company's Indian financial year (1 April - 31 March) for today, and the next one. */
  private async ensureFiscalYears(env: ErpEnvironment, ctx: ErpCallContext, company: string, abbr: string, today: Date) {
    const firstYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    for (const y of [firstYear, firstYear + 1]) {
      const year = `${abbr} FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;
      await this.ensure(env, ctx, "Fiscal Year", year, {
        year,
        year_start_date: `${y}-04-01`,
        year_end_date: `${y + 1}-03-31`,
        companies: [{ company }],
      });
    }
  }

  private async freeAbbreviation(env: ErpEnvironment, ctx: ErpCallContext, base: string): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const candidate = i === 0 ? base : `${base.slice(0, 4)}${i}`;
      const filters = encodeURIComponent(JSON.stringify([["abbr", "=", candidate]]));
      const res = await this.get(env, ctx, `/api/resource/Company?filters=${filters}&fields=${encodeURIComponent('["name"]')}`);
      if (!Array.isArray(res?.data) || res.data.length === 0) return candidate;
    }
    throw new ErpError({ kind: "validation_failed", message: "No free company abbreviation could be found.", correlationId: ctx.correlationId });
  }

  /**
   * Keeps every connected business one financial year ahead, so bills never stop on 1 April.
   * Idempotent: a year that exists is left alone. The outbox worker runs it daily, which means
   * the next year is always there long before the 15 March deadline, and a missed day costs nothing.
   */
  async renewFiscalYears(today = new Date(), correlationId = randomUUID()): Promise<{ checked: number }> {
    const tenants = await db.tenant.findMany({
      where: { erpnextProvisionStatus: "PROVISIONED", erpnextSiteId: { not: null }, erpnextCompanyId: { not: null } },
      select: { id: true, erpnextSiteId: true, erpnextCompanyId: true },
    });
    for (const t of tenants) {
      const company = await db.company.findFirst({ where: { tenantId: t.id, name: t.erpnextCompanyId! }, select: { code: true } });
      if (!company) continue;
      const env: ErpEnvironment = { tenantId: t.id, siteId: t.erpnextSiteId!, clusterId: null, companyId: t.erpnextCompanyId, version: null };
      await this.ensureFiscalYears(env, { tenantId: t.id, correlationId, causationId: t.id }, t.erpnextCompanyId!, company.code, today);
    }
    return { checked: tenants.length };
  }

  async provision(tenantId: string, correlationId: string): Promise<void> {
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true, taxId: true, erpnextSiteId: true, erpnextCompanyId: true },
    });
    try {
      // 1. Site
      let siteId = tenant.erpnextSiteId;
      if (!siteId) {
        const site = await this.sites.ensureSite({ id: tenant.id, slug: tenant.slug });
        if (site.status === "not_configured") throw new ProvisionStop(site.reason);
        if (site.status === "pending") {
          throw new ErpError({ kind: "unavailable", message: "The ERPNext site is still being created.", correlationId });
        }
        siteId = site.siteId;
        await db.tenant.update({ where: { id: tenantId }, data: { erpnextSiteId: siteId } });
      }
      const env: ErpEnvironment = { tenantId, siteId, clusterId: null, companyId: null, version: null };
      const ctx = { tenantId, correlationId, causationId: tenantId };

      // 2. ERPNext Company
      let companyName = tenant.erpnextCompanyId;
      let abbr: string | null = null;
      if (!companyName) {
        const wanted = tenant.name.trim().slice(0, 140);
        const found = await this.get(env, ctx, `/api/resource/Company/${encodeURIComponent(wanted)}`);
        const doc = found?.data as { name?: string; abbr?: string; company_description?: string; default_currency?: string } | undefined;
        if (doc?.name) {
          if (!doc.company_description?.includes(companyMarker(tenantId))) {
            throw new ProvisionStop(
              `ERPNext already has a company named "${wanted}" that this business didn't create. An administrator must confirm which company to use.`,
            );
          }
          if (doc.default_currency !== CURRENCY) {
            throw new ProvisionStop(`The ERPNext company "${wanted}" isn't in Indian rupees. An administrator must correct it.`);
          }
          companyName = doc.name;
          abbr = doc.abbr ?? null;
        } else {
          abbr = await this.freeAbbreviation(env, ctx, abbreviationFor(wanted));
          const gstin = tenant.taxId?.trim().toUpperCase() || null;
          const created = await this.client.call(env, ctx, {
            method: "POST",
            path: "/api/resource/Company",
            body: {
              company_name: wanted,
              abbr,
              default_currency: CURRENCY,
              country: COUNTRY,
              company_description: `Created by AMBURAX for this business. ${companyMarker(tenantId)}`,
              // A business that isn't GST-registered has no GSTIN; nothing is invented.
              ...(gstin ? { tax_id: gstin } : {}),
            },
          });
          companyName = (created.body as { data?: { name?: string } })?.data?.name ?? wanted;
        }
      } else {
        const doc = (await this.get(env, ctx, `/api/resource/Company/${encodeURIComponent(companyName)}`))?.data as { abbr?: string } | undefined;
        abbr = doc?.abbr ?? null;
      }

      // 2b. Tax accounts, purchase GST templates and the financial year (see ensureTaxSetup).
      if (abbr) await this.ensureTaxSetup(env, ctx, companyName, abbr);

      // 3. AMBURAX Company record, and every unlinked store linked to it.
      const code = (abbr ?? abbreviationFor(companyName)).slice(0, 20);
      const amburaxCompany = await db.company.upsert({
        where: { tenantId_code: { tenantId, code } },
        create: { tenantId, name: companyName, code, currency: CURRENCY },
        update: { name: companyName },
        select: { id: true },
      });
      await db.store.updateMany({ where: { tenantId, companyId: null }, data: { companyId: amburaxCompany.id } });

      // Connected. Stores are queued after this, so their sync sees the Company.
      await db.tenant.update({
        where: { id: tenantId },
        data: {
          erpnextCompanyId: companyName,
          erpnextProvisionStatus: "PROVISIONED",
          erpnextProvisionError: null,
          erpnextProvisionedAt: new Date(),
        },
      });

      // 4. Warehouses: queue every store that hasn't got one.
      const stores = await db.store.findMany({
        where: { tenantId, OR: [{ erpnextWarehouseId: null }, { NOT: { erpnextProvisionStatus: "PROVISIONED" } }] },
        select: { id: true },
      });
      for (const s of stores) {
        await db.$transaction((tx) =>
          enqueueOutboxEvent(tx, {
            tenantId,
            eventType: "StoreCreated",
            correlationId,
            causationId: tenantId,
            entityId: s.id,
            payload: {},
            // The store's first StoreCreated already exists; this is the re-queue after connecting.
            discriminator: `provision:${correlationId}`,
          }),
        );
      }
      await writeAuditLog({
        tenantId,
        action: "ErpConnected",
        correlationId,
        metadata: { siteId, company: companyName, storesQueued: stores.length, provisioner: this.sites.kind },
      });
    } catch (error) {
      const reason =
        error instanceof ProvisionStop
          ? error.message
          : error instanceof ErpError && error.kind === "authorization_failed"
            ? "ERPNext refused: the integration user isn't allowed to create this yet."
            : "Connecting to ERPNext didn't finish. It will try again.";
      await db.tenant.update({ where: { id: tenantId }, data: { erpnextProvisionStatus: "FAILED", erpnextProvisionError: reason } });
      // A stop needs a person, so it isn't retried; anything else is, by the outbox.
      if (error instanceof ProvisionStop) return;
      throw error;
    }
  }
}
