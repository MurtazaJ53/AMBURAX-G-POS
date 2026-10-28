import { pathToFileURL } from "node:url";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";

/**
 * Bug 31: a business registered without an owner (`BUSINESS_CREATED`) can't be finished once its
 * onboarding token expires, and nothing removed it. This job deletes those stranded sign-ups.
 *
 *   npm run tenants:cleanup-stranded            # dry run: lists what it would delete
 *   npm run tenants:cleanup-stranded -- --delete
 *
 * A tenant is stranded only when ALL of these hold — anything else is never touched:
 *   - onboardingStep is BUSINESS_CREATED (OWNER_CREATED and later resume normally)
 *   - it has no user at all, so no owner
 *   - it was created more than 7 days ago
 *   - it has no ERPNext link: provision status NOT_PROVISIONED and no ERPNext company
 *   - it has no sales, no stores and no outbox events
 *
 * The rule is checked again inside each delete's transaction, so a sign-up that progressed
 * between listing and deleting is left alone. Logs carry tenant id, name and created date only.
 */

export const STRANDED_AFTER_DAYS = 7;

export function strandedSignupWhere(now: Date): Prisma.TenantWhereInput {
  return {
    onboardingStep: "BUSINESS_CREATED",
    createdAt: { lt: new Date(now.getTime() - STRANDED_AFTER_DAYS * 24 * 60 * 60 * 1000) },
    users: { none: {} },
    erpnextProvisionStatus: "NOT_PROVISIONED",
    erpnextCompanyId: null,
    sales: { none: {} },
    stores: { none: {} },
    outboxEvents: { none: {} },
  };
}

export interface StrandedTenant {
  id: string;
  name: string;
  createdAt: string;
}

export interface CleanupSummary {
  mode: "dry-run" | "delete";
  matched: StrandedTenant[];
  deleted: string[];
  skipped: { id: string; reason: string }[];
}

type Log = (line: Record<string, unknown>) => void;
const jsonLog: Log = (line) => console.log(JSON.stringify(line));

export async function cleanupStrandedSignups(params: {
  delete: boolean;
  now?: Date;
  log?: Log;
}): Promise<CleanupSummary> {
  const now = params.now ?? new Date();
  const log = params.log ?? jsonLog;
  const where = strandedSignupWhere(now);
  const mode = params.delete ? "delete" : "dry-run";

  const rows = await db.tenant.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, createdAt: true },
  });
  const matched = rows.map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt.toISOString() }));
  log({ level: "info", scope: "stranded sign-up cleanup", mode, matched: matched.length });
  for (const t of matched) {
    log({ level: "info", scope: "stranded sign-up cleanup", action: params.delete ? "deleting" : "would delete", ...t });
  }

  const summary: CleanupSummary = { mode, matched, deleted: [], skipped: [] };
  if (!params.delete) return summary;

  for (const t of matched) {
    try {
      const removed = await db.$transaction(async (tx) => {
        // Re-check under the transaction: never delete a sign-up that moved on.
        const still = await tx.tenant.findFirst({ where: { ...where, id: t.id }, select: { id: true } });
        if (!still) return false;
        // Rows created with the tenant at registration whose foreign key does not cascade.
        // Capabilities and garment masters cascade with the tenant.
        await tx.onboardingSession.deleteMany({ where: { tenantId: t.id } });
        await tx.uom.deleteMany({ where: { tenantId: t.id } });
        await tx.tenant.delete({ where: { id: t.id } });
        return true;
      });
      if (removed) {
        summary.deleted.push(t.id);
        log({ level: "info", scope: "stranded sign-up cleanup", action: "deleted", id: t.id });
      } else {
        summary.skipped.push({ id: t.id, reason: "no longer stranded" });
        log({ level: "info", scope: "stranded sign-up cleanup", action: "skipped", id: t.id, reason: "no longer stranded" });
      }
    } catch (err) {
      // Anything else still referencing the tenant (a restricting foreign key) means it is not a
      // bare sign-up: leave it, and say so.
      const reason = err instanceof Prisma.PrismaClientKnownRequestError ? err.code : "error";
      summary.skipped.push({ id: t.id, reason });
      log({ level: "warn", scope: "stranded sign-up cleanup", action: "skipped", id: t.id, reason });
    }
  }

  log({
    level: "info",
    scope: "stranded sign-up cleanup",
    mode,
    deleted: summary.deleted.length,
    skipped: summary.skipped.length,
  });
  return summary;
}

export function parseArgs(argv: string[]): { delete: boolean } {
  return { delete: argv.includes("--delete") };
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  cleanupStrandedSignups(parseArgs(process.argv.slice(2)))
    .then(() => {
      process.exitCode = 0;
    })
    .catch((err) => {
      console.error(JSON.stringify({ level: "error", scope: "stranded sign-up cleanup", message: String(err) }));
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect().catch(() => {}));
}
