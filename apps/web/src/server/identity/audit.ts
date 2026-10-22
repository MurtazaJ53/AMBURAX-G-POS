import { Prisma } from "@prisma/client";
import { db } from "@/server/db";

export interface AuditLogParams {
  tenantId?: string;
  userId?: string;
  action: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
}

function auditData(params: AuditLogParams): Prisma.AuditLogUncheckedCreateInput {
  return {
    tenantId: params.tenantId,
    userId: params.userId,
    action: params.action,
    correlationId: params.correlationId,
    metadata: params.metadata as Prisma.InputJsonValue | undefined,
  };
}

export async function writeAuditLog(params: AuditLogParams): Promise<void> {
  await db.auditLog.create({ data: auditData(params) });
}

/**
 * The same audit row, written inside the caller's transaction so it commits or rolls back with
 * the change it records. Use this wherever a missing or orphaned audit row would matter.
 */
export async function writeAuditLogTx(tx: Prisma.TransactionClient, params: AuditLogParams): Promise<void> {
  await tx.auditLog.create({ data: auditData(params) });
}
