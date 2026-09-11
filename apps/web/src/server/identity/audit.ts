import { Prisma } from "@prisma/client";
import { db } from "@/server/db";

export async function writeAuditLog(params: {
  tenantId?: string;
  userId?: string;
  action: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      action: params.action,
      correlationId: params.correlationId,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
