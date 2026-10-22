import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface DuplicateProductRow {
  product_id: string;
  name: string;
  brand: string | null;
  is_active: boolean;
  created_at: Date;
  normalized_name: string;
  normalized_brand: string;
  variant_count: number;
  total_stock: number;
  group_count: number;
}

interface DuplicateSkuRow {
  sku: string;
  count: number;
  product_names: string;
  variant_ids: string;
}

interface DuplicateBarcodeRow {
  barcode: string;
  count: number;
  product_names: string;
  variant_ids: string;
}

interface TenantSummary {
  id: string;
  name: string;
  productCount: number;
  duplicateGroupCount: number;
  duplicateSkuCount: number;
  duplicateBarcodeCount: number;
}

async function runStep1AuditFast() {
  console.log("================================================================================");
  console.log("   STEP 1: DATABASE-NATIVE PRODUCT DUPLICATE & INTEGRITY AUDIT                   ");
  console.log("   (Fast SQL GROUP BY ... HAVING count(*) > 1 — No bind variable limit)        ");
  console.log("================================================================================\n");

  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const failedTenants: string[] = [];
  const summaries: TenantSummary[] = [];

  for (const tenant of tenants) {
    console.log(`\n================================================================================`);
    console.log(`🏢 Tenant: "${tenant.name}" (${tenant.id})`);
    console.log(`================================================================================`);

    try {
      // 1. Total product count for this tenant
      const countRes = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM "products" WHERE "tenantId" = ${tenant.id}
      `;
      const totalProducts = Number(countRes[0]?.count ?? 0);
      console.log(`📊 Total Products (Active & Archived): ${totalProducts}`);

      // 2. Duplicate Products Query using regex clean:
      // regexp_replace(lower("name"), '[^a-z0-9]', '', 'g')
      const duplicateProducts = await prisma.$queryRaw<DuplicateProductRow[]>`
        WITH normed AS (
          SELECT
            p."id" AS product_id,
            p."name",
            p."brand",
            p."isActive" AS is_active,
            p."createdAt" AS created_at,
            regexp_replace(lower(p."name"), '[^a-z0-9]', '', 'g') AS normalized_name,
            COALESCE(regexp_replace(lower(p."brand"), '[^a-z0-9]', '', 'g'), '') AS normalized_brand
          FROM "products" p
          WHERE p."tenantId" = ${tenant.id}
        ),
        groups AS (
          SELECT
            normalized_name,
            normalized_brand,
            COUNT(*) AS group_count
          FROM normed
          GROUP BY normalized_name, normalized_brand
          HAVING COUNT(*) > 1
        )
        SELECT
          n.product_id,
          n.name,
          n.brand,
          n.is_active,
          n.created_at,
          n.normalized_name,
          n.normalized_brand,
          g.group_count::int,
          (SELECT COUNT(*) FROM "product_variants" pv WHERE pv."productId" = n.product_id)::int AS variant_count,
          COALESCE(
            (SELECT SUM(sl."quantity") 
             FROM "stock_levels" sl 
             JOIN "product_variants" pv ON pv."id" = sl."variantId" 
             WHERE pv."productId" = n.product_id), 0
          )::int AS total_stock
        FROM normed n
        JOIN groups g 
          ON n.normalized_name = g.normalized_name 
         AND n.normalized_brand = g.normalized_brand
        ORDER BY n.normalized_name ASC, n.normalized_brand ASC, n.created_at ASC
      `;

      // Group rows by normalized key
      const productGroups = new Map<string, DuplicateProductRow[]>();
      for (const row of duplicateProducts) {
        const key = `${row.normalized_name}:::${row.normalized_brand}`;
        const list = productGroups.get(key) || [];
        list.push(row);
        productGroups.set(key, list);
      }

      if (productGroups.size === 0) {
        console.log(`✅ Product Names: 0 duplicates by (normalized name + normalized brand).`);
      } else {
        console.log(`⚠️ Product Names: Found ${productGroups.size} DUPLICATE GROUP(S) (${duplicateProducts.length} products total):`);
        let gIdx = 1;
        for (const [key, items] of productGroups.entries()) {
          const [nName, nBrand] = key.split(":::");
          console.log(`\n  ┌── Group #${gIdx++} [Normalized Name: "${nName}", Brand: "${nBrand || "(empty)"}"] (${items.length} products)`);
          for (const item of items) {
            console.log(
              `  │  • Product ID:   ${item.product_id}\n` +
              `  │    Name / Brand: "${item.name}" | Brand: "${item.brand ?? "None"}"\n` +
              `  │    Status:       ${item.is_active ? "ACTIVE" : "ARCHIVED"}\n` +
              `  │    Variants:     ${item.variant_count} variant(s)\n` +
              `  │    Stock:        ${item.total_stock} pcs counted\n` +
              `  │    Created At:   ${new Date(item.created_at).toISOString()}`
            );
          }
          console.log(`  └──`);
        }
      }

      // 3. Duplicate SKUs Query
      const duplicateSkus = await prisma.$queryRaw<DuplicateSkuRow[]>`
        SELECT
          lower(trim(pv."sku")) AS sku,
          COUNT(*)::int AS count,
          string_agg(DISTINCT p."name", ', ') AS product_names,
          string_agg(pv."id", ', ') AS variant_ids
        FROM "product_variants" pv
        JOIN "products" p ON p."id" = pv."productId"
        WHERE pv."tenantId" = ${tenant.id}
        GROUP BY lower(trim(pv."sku"))
        HAVING COUNT(*) > 1
        ORDER BY count DESC
      `;

      if (duplicateSkus.length === 0) {
        console.log(`✅ SKUs: 0 duplicate SKUs found.`);
      } else {
        console.log(`⚠️ SKUs: Found ${duplicateSkus.length} DUPLICATE SKU(S):`);
        for (const s of duplicateSkus) {
          console.log(`  • SKU "${s.sku}" (used ${s.count} times) across: ${s.product_names}`);
        }
      }

      // 4. Duplicate Barcodes Query (inspecting both product_variants and variant_barcodes if present)
      let duplicateBarcodes: DuplicateBarcodeRow[] = [];
      try {
        duplicateBarcodes = await prisma.$queryRaw<DuplicateBarcodeRow[]>`
          SELECT
            trim(b."barcode") AS barcode,
            COUNT(*)::int AS count,
            string_agg(DISTINCT p."name", ', ') AS product_names,
            string_agg(b."variantId", ', ') AS variant_ids
          FROM "variant_barcodes" b
          JOIN "product_variants" pv ON pv."id" = b."variantId"
          JOIN "products" p ON p."id" = pv."productId"
          WHERE b."tenantId" = ${tenant.id}
          GROUP BY trim(b."barcode")
          HAVING COUNT(*) > 1
          ORDER BY count DESC
        `;
      } catch {
        // Fallback to product_variants.barcode if variant_barcodes table does not exist
        duplicateBarcodes = await prisma.$queryRaw<DuplicateBarcodeRow[]>`
          SELECT
            trim(pv."barcode") AS barcode,
            COUNT(*)::int AS count,
            string_agg(DISTINCT p."name", ', ') AS product_names,
            string_agg(pv."id", ', ') AS variant_ids
          FROM "product_variants" pv
          JOIN "products" p ON p."id" = pv."productId"
          WHERE pv."tenantId" = ${tenant.id} AND pv."barcode" IS NOT NULL AND trim(pv."barcode") != ''
          GROUP BY trim(pv."barcode")
          HAVING COUNT(*) > 1
          ORDER BY count DESC
        `;
      }

      if (duplicateBarcodes.length === 0) {
        console.log(`✅ Barcodes: 0 duplicate barcodes found.`);
      } else {
        console.log(`⚠️ Barcodes: Found ${duplicateBarcodes.length} DUPLICATE BARCODE(S):`);
        for (const b of duplicateBarcodes) {
          console.log(`  • Barcode "${b.barcode}" (used ${b.count} times) across: ${b.product_names}`);
        }
      }

      summaries.push({
        id: tenant.id,
        name: tenant.name,
        productCount: totalProducts,
        duplicateGroupCount: productGroups.size,
        duplicateSkuCount: duplicateSkus.length,
        duplicateBarcodeCount: duplicateBarcodes.length,
      });

    } catch (err) {
      console.error(`❌ ERROR while auditing tenant "${tenant.name}":`, err);
      failedTenants.push(tenant.name);
    }
  }

  console.log("\n================================================================================");
  console.log("                        AUDIT SUMMARY BY TENANT                                 ");
  console.log("================================================================================");
  console.table(
    summaries.map((s) => ({
      Tenant: s.name,
      "Total Products": s.productCount,
      "Duplicate Product Groups": s.duplicateGroupCount,
      "Duplicate SKUs": s.duplicateSkuCount,
      "Duplicate Barcodes": s.duplicateBarcodeCount,
    }))
  );

  if (failedTenants.length > 0) {
    console.error(`\n❌❌ AUDIT INCOMPLETE! Failed tenants: ${failedTenants.join(", ")}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("\n✅ AUDIT COMPLETE: All tenants audited successfully without errors.");
  await prisma.$disconnect();
}

runStep1AuditFast().catch((err) => {
  console.error("Audit runner failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
