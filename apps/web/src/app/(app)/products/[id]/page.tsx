import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageCatalog } from "@/server/catalog/catalogRoles";
import { getProduct } from "@/server/catalog/catalogQueries";
import { db } from "@/server/db";
import { ProductDetailsView } from "./ProductDetailsView";

export default async function ProductDetailsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const sessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(sessionToken);

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding");
  
  const canManage = canManageCatalog(resolved.context.tenantRole);
  
  const product = await getProduct({
    tenantId: resolved.context.tenantId,
    productId: id,
    storeId: resolved.context.storeId,
  });
  if (!product) return notFound();

  // Fetch recent sales for this product using correct model name SaleItem
  const variantIds = product.variants.map((v) => v.id);
  const recentSaleItems = variantIds.length > 0 ? await db.saleItem.findMany({
    where: {
      tenantId: resolved.context.tenantId,
      variantId: { in: variantIds },
    },
    take: 10,
    orderBy: { id: "desc" },
    include: {
      sale: {
        select: {
          id: true,
          billNumber: true,
          completedAt: true,
          totalMinor: true,
          cashier: { select: { name: true } },
        },
      },
    },
  }) : [];

  const recentSales = recentSaleItems.map((si) => ({
    id: si.sale.id,
    billNumber: si.sale.billNumber,
    completedAt: si.sale.completedAt,
    totalMinor: si.quantity * si.unitPriceMinor - si.lineDiscountMinor,
    cashierName: si.sale.cashier.name,
    quantity: si.quantity,
  }));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ProductDetailsView
        product={product}
        canManage={canManage}
        storeName={resolved.context.storeName}
        recentSales={recentSales}
      />
    </div>
  );
}
