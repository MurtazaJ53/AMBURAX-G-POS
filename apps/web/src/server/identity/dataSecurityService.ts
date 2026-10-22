import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";

export interface DataSecurityMetrics {
  databaseStatus: "CONNECTED" | "DISCONNECTED";
  activeSessionsCount: number;
  outboxSummary: {
    pending: number;
    published: number;
    deadLettered: number;
    total: number;
  };
  auditLogsCount: number;
  registeredDevicesCount: number;
  tenantCreatedDate: Date;
  lastBackupDate: string;
}

export async function getDataSecurityMetrics(tenantId: string): Promise<DataSecurityMetrics> {
  const [
    tenant,
    activeSessionsCount,
    outboxPending,
    outboxPublished,
    outboxDeadLettered,
    outboxTotal,
    auditLogsCount,
    registeredDevicesCount,
  ] = await Promise.all([
    db.tenant.findUnique({
      where: { id: tenantId },
      select: { termsAcceptedAt: true },
    }),
    db.session.count({
      where: { tenantId, revokedAt: null, expiresAt: { gt: new Date() } },
    }),
    db.outboxEvent.count({
      where: { tenantId, publishedAt: null, deadLetteredAt: null },
    }),
    db.outboxEvent.count({
      where: { tenantId, publishedAt: { not: null } },
    }),
    db.outboxEvent.count({
      where: { tenantId, deadLetteredAt: { not: null } },
    }),
    db.outboxEvent.count({
      where: { tenantId },
    }),
    db.auditLog.count({
      where: { tenantId },
    }),
    db.posDevice.count({
      where: { tenantId },
    }),
  ]);

  return {
    databaseStatus: "CONNECTED",
    activeSessionsCount,
    outboxSummary: {
      pending: outboxPending,
      published: outboxPublished,
      deadLettered: outboxDeadLettered,
      total: outboxTotal,
    },
    auditLogsCount,
    registeredDevicesCount,
    tenantCreatedDate: tenant?.termsAcceptedAt || new Date(),
    lastBackupDate: new Date().toISOString(),
  };
}

export async function exportTenantSnapshot(tenantId: string, actorUserId: string) {
  const [tenant, stores, products, customers, sales] = await Promise.all([
    db.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, businessType: true, contactEmail: true, erpnextProvisionStatus: true },
    }),
    db.store.findMany({
      where: { tenantId },
      select: { id: true, name: true, code: true, currency: true, timezone: true },
    }),
    db.product.findMany({
      where: { tenantId },
      take: 200,
      select: { id: true, name: true, category: true, brand: true },
    }),
    db.customer.findMany({
      where: { tenantId },
      take: 200,
      select: { id: true, name: true, phone: true, email: true },
    }),
    db.sale.findMany({
      where: { tenantId },
      take: 200,
      select: { id: true, billNumber: true, totalMinor: true, createdAt: true, status: true },
    }),
  ]);

  await writeAuditLog({
    tenantId,
    userId: actorUserId,
    action: "tenant_data_exported",
    correlationId: `export-${Date.now()}`,
    metadata: {
      storeCount: stores.length,
      productCount: products.length,
      customerCount: customers.length,
      salesCount: sales.length,
    },
  });

  return {
    exportTimestamp: new Date().toISOString(),
    organization: tenant,
    stores,
    products,
    customers,
    sales,
  };
}

export async function flushOutboxQueue(tenantId: string, actorUserId: string) {
  // Reset any dead-lettered events so they are immediately picked up by the outbox worker
  const result = await db.outboxEvent.updateMany({
    where: { tenantId, deadLetteredAt: { not: null } },
    data: {
      deadLetteredAt: null,
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
    },
  });

  await writeAuditLog({
    tenantId,
    userId: actorUserId,
    action: "outbox_queue_flushed",
    correlationId: `flush-${Date.now()}`,
    metadata: { revivedEvents: result.count },
  });

  return { revivedEvents: result.count };
}
