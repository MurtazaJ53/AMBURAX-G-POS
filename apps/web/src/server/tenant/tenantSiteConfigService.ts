import { db } from "@/server/db";
import { ErpClient } from "@/server/erp/client";
import { EnvErpCredentialProvider, type ErpEnvironment } from "@/server/erp/config";
import { ErpError } from "@/server/erp/errors";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import type { ErpTransport } from "@/server/erp/transport";
import { writeAuditLogTx } from "@/server/identity/audit";
import { randomUUID } from "node:crypto";

export interface Actor {
  userId: string;
  tenantId?: string;
  role?: string;
}

export interface ConfigureTenantErpSiteResult {
  status: "ok" | "site_unreachable" | "tenant_not_found";
  redrivenCount?: number;
  error?: string;
}

const PING_PATH = "/api/method/frappe.ping";

export async function configureTenantErpSite(
  tenantId: string,
  siteId: string,
  actor: Actor,
  transport?: ErpTransport,
  credentials?: EnvErpCredentialProvider,
  correlationId = randomUUID()
): Promise<ConfigureTenantErpSiteResult> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!tenant) {
    return { status: "tenant_not_found", error: `Tenant ${tenantId} not found.` };
  }

  // 1. Preflight ping check with ErpClient
  const client = new ErpClient(transport ?? new HttpErpTransport(), credentials ?? new EnvErpCredentialProvider());
  const env: ErpEnvironment = {
    tenantId,
    siteId,
    clusterId: null,
    companyId: null,
    version: null,
  };

  try {
    await client.call(
      env,
      { tenantId, correlationId, causationId: tenantId },
      { method: "GET", path: PING_PATH }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Reject and leave tenant paused
    return {
      status: "site_unreachable",
      error: `ERPNext site ${siteId} is unreachable or invalid: ${message}`,
    };
  }

  // 2. Atomic transaction: update tenant, re-drive matching dead-lettered events, write audit row
  return await db.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        erpnextSiteId: siteId,
        isSyncPaused: false,
        syncPausedReason: null,
      },
    });

    const updateResult = await tx.outboxEvent.updateMany({
      where: {
        tenantId,
        publishedAt: null,
        deadLetteredAt: { not: null },
        failureCode: "ERP_SITE_NOT_SET",
      },
      data: {
        deadLetteredAt: null,
        attempts: 0,
        nextAttemptAt: new Date(),
        failureCode: null,
        lastError: null,
      },
    });

    await writeAuditLogTx(tx, {
      tenantId,
      userId: actor.userId,
      action: "TenantErpSiteConfiguredAndOutboxRedriven",
      correlationId,
      metadata: {
        siteId,
        redrivenCount: updateResult.count,
        reason: "ADMIN_SITE_ASSIGNMENT",
      },
    });

    return {
      status: "ok",
      redrivenCount: updateResult.count,
    };
  });
}
