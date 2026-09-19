import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { db } from "@/server/db";
import { AdjustStockForm } from "./AdjustStockForm";
import { ArrowLeft } from "lucide-react";

export default async function NewAdjustmentPage() {
  const sessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(sessionToken);

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding");

  if (
    !canManageInventory({
      tenantRole: resolved.context.tenantRole,
      membershipRole: resolved.context.membershipRole,
    })
  ) {
    redirect("/inventory");
  }

  const tenantId = resolved.context.tenantId;
  const storeId = resolved.context.storeId;

  const variants = await db.productVariant.findMany({
    where: { tenantId, isActive: true },
    include: { product: true },
    orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
  });

  const variantOptions = variants.map((v) => ({
    id: v.id,
    sku: v.sku,
    name: `${v.product.name}${[v.size, v.colour].filter(Boolean).length > 0 ? ` (${[v.size, v.colour].filter(Boolean).join(" / ")})` : ""}`,
    imageUrl: v.product.imageUrl,
  }));

  // Fetch current stock levels for the store so the form can show "current → result" preview.
  // Only variants that have a level row are included; missing rows imply 0 stock.
  const levels = await db.stockLevel.findMany({
    where: { tenantId, storeId },
    select: { variantId: true, quantity: true },
  });

  const stockByVariant: Record<string, number> = {};
  for (const l of levels) {
    stockByVariant[l.variantId] = l.quantity;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-4xl p-4 sm:p-6 lg:p-8">
        <div className="mb-6">
          <Link
            href="/inventory"
            className="inline-flex items-center text-sm font-medium text-secondary hover:text-primary transition-colors"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Inventory
          </Link>
        </div>

        <AdjustStockForm
          variants={variantOptions}
          storeId={storeId}
          stockByVariant={stockByVariant}
        />
      </div>
    </div>
  );
}
