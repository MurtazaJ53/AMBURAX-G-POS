import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageCatalog } from "@/server/catalog/catalogRoles";
import { listUoms } from "@/server/uom/uomService";
import { db } from "@/server/db";
import { AddProductWizard } from "./AddProductWizard";
import { ProductForm } from "../ProductForm";

export default async function NewProductPage(props: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const searchParams = await props.searchParams;
  const sessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(sessionToken);

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding");
  if (!canManageCatalog(resolved.context.tenantRole)) {
    redirect("/products");
  }

  const tenantId = resolved.context.tenantId;

  // 1. Fetch Units of Measure
  const uoms = await listUoms(tenantId);

  // If user requests legacy form via ?mode=classic, render original ProductForm
  if (searchParams.mode === "classic") {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">Add Product (Classic Mode)</h1>
          <a
            href="/products/new"
            className="text-xs font-semibold text-primary hover:underline"
          >
            Switch to New Garment Wizard →
          </a>
        </div>
        <ProductForm uoms={uoms} />
      </div>
    );
  }

  // 2. Fetch Active Stores / Warehouses for multi-store opening stock
  const stores = await db.store.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      storeType: true,
      isDefault: true,
    },
  });

  // 3. Fetch Master Attribute Definitions & Values (Sizes & Colors with swatches)
  const attributeDefinitions = await db.attributeDefinition.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      values: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          value: true,
          code: true,
          colorHex: true,
          sortOrder: true,
        },
      },
    },
  });

  // 4. Fetch Tenant Size Groups
  const sizeGroupsRaw = await db.sizeGroup.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: {
          value: {
            select: {
              id: true,
              value: true,
              code: true,
              isActive: true,
            },
          },
        },
      },
    },
  });

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

  // 5. Fetch existing categories and brands for smart suggestion combo boxes
  const [categoryRows, brandRows] = await Promise.all([
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

  // A shop without a GSTIN can't charge GST; the wizard must not offer it.
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { taxId: true } });
  const gstRegistered = Boolean(tenant?.taxId?.trim());

  const categories = categoryRows.map((r) => r.category).filter((c): c is string => Boolean(c));
  const brands = brandRows.map((r) => r.brand).filter((b): b is string => Boolean(b));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <AddProductWizard
        uoms={uoms}
        stores={stores}
        attributeDefinitions={attributeDefinitions}
        sizeGroups={sizeGroups}
        categories={categories}
        brands={brands}
        gstRegistered={gstRegistered}
      />
    </div>
  );
}
