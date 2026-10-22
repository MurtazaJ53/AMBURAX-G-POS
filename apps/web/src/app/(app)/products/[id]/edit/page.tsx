import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageCatalog } from "@/server/catalog/catalogRoles";
import { getProduct } from "@/server/catalog/catalogQueries";
import { listUoms } from "@/server/uom/uomService";
import { getApparelSlab } from "@/server/tax/taxSettings";
import { db } from "@/server/db";
import { ProductEditor } from "./ProductEditor";

export default async function EditProductPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const sessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(sessionToken);

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding");
  if (!canManageCatalog(resolved.context.tenantRole)) redirect("/products");

  const tenantId = resolved.context.tenantId;

  const product = await getProduct({
    tenantId,
    productId: id,
    storeId: resolved.context.storeId,
  });
  if (!product) return notFound();

  const [uoms, stores, attributeDefinitions, sizeGroupsRaw, slab, categoryRows, brandRows] =
    await Promise.all([
      listUoms(tenantId),
      db.store.findMany({
        where: { tenantId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: { id: true, name: true, code: true },
      }),
      db.attributeDefinition.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          values: {
            where: { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: { id: true, value: true, code: true, colorHex: true },
          },
        },
      }),
      db.sizeGroup.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
            include: { value: { select: { id: true, value: true, code: true, isActive: true } } },
          },
        },
      }),
      getApparelSlab(tenantId),
      db.product.groupBy({
        by: ["category"],
        where: { tenantId, category: { not: null } },
        orderBy: { category: "asc" },
      }),
      db.product.groupBy({
        by: ["brand"],
        where: { tenantId, brand: { not: null } },
        orderBy: { brand: "asc" },
      }),
    ]);

  const sizeGroups = sizeGroupsRaw.map((g) => ({
    id: g.id,
    name: g.name,
    code: g.code,
    sizes: g.items
      .filter((item) => item.value.isActive)
      .map((item) => ({
        id: item.value.id,
        name: item.value.value,
        code: item.value.code,
      })),
  }));

  const categories = categoryRows.map((r) => r.category).filter((c): c is string => Boolean(c));
  const brands = brandRows.map((r) => r.brand).filter((b): b is string => Boolean(b));
  const slabLabel = `Garment slab (${slab.lowRateBp / 100}% ≤₹${slab.thresholdMinor / 100}, ${slab.highRateBp / 100}% >₹${slab.thresholdMinor / 100})`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ProductEditor
        initialData={product}
        uoms={uoms}
        stores={stores}
        attributeDefinitions={attributeDefinitions}
        sizeGroups={sizeGroups}
        categories={categories}
        brands={brands}
        slabLabel={slabLabel}
      />
    </div>
  );
}
