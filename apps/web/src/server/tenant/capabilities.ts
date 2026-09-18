import { db } from "@/server/db";
import { Capability } from "@prisma/client";

export async function getTenantCapabilities(tenantId: string): Promise<Capability[]> {
  const caps = await db.tenantCapability.findMany({
    where: { tenantId, enabled: true },
    select: { capability: true }
  });
  return caps.map(c => c.capability);
}
