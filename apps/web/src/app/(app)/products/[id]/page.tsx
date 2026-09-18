import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageCatalog } from "@/server/catalog/catalogRoles";
import { getProduct } from "@/server/catalog/catalogQueries";
import { PageHeader, Card, buttonClass, BadgeTone, StatusBadge } from "../../_components/ui";
import Link from "next/link";

export default async function ProductDetailsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const sessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(sessionToken);

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding");
  
  const canManage = canManageCatalog(resolved.context.tenantRole);
  
  const product = await getProduct({ tenantId: resolved.context.tenantId, productId: id });
  if (!product) return notFound();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title={product.name}
        subtitle={product.category || "Uncategorized"}
        actions={
          canManage && (
            <Link href={`/products/${product.id}/edit`} className={buttonClass("secondary")}>
              Edit Product
            </Link>
          )
        }
      />
      
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Product Details */}
        <Card className="p-6">
          <h2 className="text-base font-semibold leading-7 text-slate-900">Product Info</h2>
          <dl className="mt-4 space-y-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Brand</dt>
              <dd className="font-medium text-slate-900">{product.brand || "-"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Status</dt>
              <dd>
                <StatusBadge tone={(product.isActive ? "success" : "neutral") as BadgeTone}>
                  {product.isActive ? "Active" : "Inactive"}
                </StatusBadge>
              </dd>
            </div>
          </dl>
        </Card>

        {/* Variants List */}
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold leading-7 text-slate-900">Variants</h2>
            {canManage && (
              <Link href={`/products/${product.id}/variants/new`} className={buttonClass("primary")}>
                + Add Variant
              </Link>
            )}
          </div>
          
          <div className="mt-4 flow-root">
            <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
              <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
                <table className="min-w-full divide-y divide-slate-300">
                  <thead>
                    <tr>
                      <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-slate-900 sm:pl-0">SKU</th>
                      <th className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900">Details</th>
                      <th className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900">Price</th>
                      <th className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900">Status</th>
                      <th className="relative py-3.5 pl-3 pr-4 sm:pr-0">
                        <span className="sr-only">Edit</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {product.variants.map((v) => (
                      <tr key={v.id}>
                        <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-slate-900 sm:pl-0">
                          {v.sku}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-500">
                          {[v.size, v.colour].filter(Boolean).join(" / ") || "-"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-500">
                          {v.priceMinor != null ? `$${(v.priceMinor / 100).toFixed(2)}` : "-"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-500">
                          <StatusBadge tone={(v.isActive ? "success" : "neutral") as BadgeTone}>
                            {v.isActive ? "Active" : "Inactive"}
                          </StatusBadge>
                        </td>
                        <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-0">
                          {canManage && (
                            <Link href={`/products/${product.id}/variants/${v.id}/edit`} className="text-blue-600 hover:text-blue-900">
                              Edit<span className="sr-only">, {v.sku}</span>
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                    {product.variants.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-sm text-slate-500">
                          No variants found. Add one to start selling this product.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
