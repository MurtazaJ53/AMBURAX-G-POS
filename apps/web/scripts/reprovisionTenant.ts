/** Re-runs backend setup for one connected business (idempotent). Usage: tsx scripts/reprovisionTenant.ts <tenant-slug> */
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { TenantProvisioner } from "../src/server/erp/tenantProvisioning";

const slug = process.argv[2];
if (!slug) throw new Error("tenant slug required");
const tenant = await db.tenant.findUniqueOrThrow({ where: { slug }, select: { id: true } });
await new TenantProvisioner().provision(tenant.id, randomUUID());
console.log("provisioned", slug);
await db.$disconnect();
