import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageCatalog } from "@/server/catalog/catalogRoles";
import { getProduct } from "@/server/catalog/catalogQueries";
import { listUoms } from "@/server/uom/uomService";
import { PageHeader, Card } from "../../../_components/ui";
import { ProductForm } from "../../ProductForm";

export default async function EditProductPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const sessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(sessionToken);

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding");
  if (!canManageCatalog(resolved.context.tenantRole)) redirect("/products");

  const product = await getProduct({ tenantId: resolved.context.tenantId, productId: id });
  if (!product) return notFound();

  const uoms = await listUoms(resolved.context.tenantId);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader title="Edit Product" subtitle={`Update ${product.name}`} />
      <Card className="mt-6 p-4 sm:p-6">
        <ProductForm initialData={product} uoms={uoms} />
      </Card>
    </div>
  );
}
