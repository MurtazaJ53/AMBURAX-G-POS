import { db } from "@/server/db";

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const where = {
    erpnextProvisionStatus: "PROVISIONED" as const,
    erpnextCompanyId: null,
  };

  console.log(`[StatusFix] Mode: ${isDryRun ? "DRY-RUN (no changes)" : "LIVE EXECUTION"}`);

  const matching = await db.tenant.findMany({
    where,
    select: { id: true, name: true, slug: true, erpnextProvisionStatus: true, erpnextCompanyId: true },
  });

  console.log(`[StatusFix] Matched tenants count: ${matching.length}`);
  console.log("[StatusFix] Matching tenants:");
  matching.forEach((t, i) => {
    console.log(`  ${i + 1}. [${t.id}] "${t.name}" (slug: ${t.slug}) - status: ${t.erpnextProvisionStatus}`);
  });

  if (isDryRun) {
    console.log("[StatusFix] Dry-run complete. Exiting without modifications.");
    return;
  }

  const updateResult = await db.tenant.updateMany({
    where,
    data: {
      erpnextProvisionStatus: "NOT_PROVISIONED",
      erpnextProvisionedAt: null,
    },
  });

  console.log(`[StatusFix] Successfully updated ${updateResult.count} tenants to NOT_PROVISIONED.`);

  // Verify
  const remaining = await db.tenant.count({ where });
  console.log(`[StatusFix] Remaining tenants with PROVISIONED & null companyId: ${remaining}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[StatusFix] Error:", e);
    process.exit(1);
  });
