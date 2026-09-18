import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageCatalog } from "@/server/catalog/catalogRoles";
import { PageHeader, Card } from "../../../../_components/ui";
import { VariantForm } from "../../VariantForm";

export default async function NewVariantPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const sessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(sessionToken);

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding");
  if (!canManageCatalog(resolved.context.tenantRole)) {
    redirect("/products");
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Add Product"
        subtitle="Create a new product in your catalogue."
      />
      <Card className="mt-6 p-4 sm:p-6">
        <VariantForm productId={id} />
      </Card>
    </div>
  );
}





