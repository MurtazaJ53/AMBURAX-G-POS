import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { db } from "@/server/db";
import { PageHeader } from "../../../_components/ui";
import { ReceiveStockForm } from "./ReceiveStockForm";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function NewReceiptPage() {
  const sessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(sessionToken);

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding");
  
  if (!canManageInventory({
    tenantRole: resolved.context.tenantRole,
    membershipRole: resolved.context.membershipRole
  })) {
    redirect("/inventory");
  }

  const tenantId = resolved.context.tenantId;

  const variants = await db.productVariant.findMany({
    where: { tenantId, isActive: true },
    include: { product: true },
    orderBy: [{ product: { name: "asc" } }, { sku: "asc" }]
  });

  const variantOptions = variants.map(v => ({
    id: v.id,
    sku: v.sku,
    name: `${v.product.name} ${[v.size, v.colour].filter(Boolean).join(" / ") ? `(${[v.size, v.colour].filter(Boolean).join(" / ")})` : ""}`,
    imageUrl: v.product.imageUrl
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4">
        <Link href="/inventory" className="text-sm font-medium text-slate-500 hover:text-slate-700 flex items-center">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Inventory
        </Link>
      </div>

      <PageHeader
        title="Receive Stock"
        subtitle="Record incoming goods into the store."
      />
      
      <div className="mt-6">
        <ReceiveStockForm variants={variantOptions} storeId={resolved.context.storeId} />
      </div>
    </div>
  );
}
