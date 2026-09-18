import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageCatalog } from "@/server/catalog/catalogRoles";
import { getProduct, getVariant } from "@/server/catalog/catalogQueries";
import { PageHeader, Card } from "../../../../../_components/ui";
import { VariantForm } from "../../../VariantForm";

export default async function EditVariantPage(props: { params: Promise<{ id: string; variantId: string }> }) {
  const { id, variantId } = await props.params;
  const sessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(sessionToken);

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding");
  if (!canManageCatalog(resolved.context.tenantRole)) redirect("/products");

  const [product, variant] = await Promise.all([
    getProduct({ tenantId: resolved.context.tenantId, productId: id }),
    getVariant({ tenantId: resolved.context.tenantId, variantId })
  ]);
  
  if (!product || !variant) return notFound();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader title="Edit Variant" subtitle={`Update variant for ${product.name}`} />
      <Card className="mt-6 p-4 sm:p-6">
        <VariantForm productId={id} variant={variant} />
      </Card>
    </div>
  );
}
