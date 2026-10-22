import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { db } from "@/server/db";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { getFlipkartChannels } from "@/server/commerce/flipkart";
import { PageHeader } from "../_components/ui";
import { CommerceClient } from "./CommerceClient";

export const metadata = {
  title: "Commerce & Marketplace Engine — AMBURAX POS",
};

/**
 * Phase 6 & 8: Commerce Engine (Flipkart Marketplace Integration)
 *
 * Implements external commerce channel connections, catalog listing mappings,
 * channel pricing / buffer allocation, and order ingestion into canonical models.
 */
export default async function CommercePage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("commerce: context failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let channels: Awaited<ReturnType<typeof getFlipkartChannels>>;
  let variants: any[];
  let recentOrders: any[];

  try {
    // 1. Fetch connected channels
    channels = await getFlipkartChannels(ctx.tenantId);

    // 2. Fetch catalog product variants for mapping dropdown
    variants = await db.productVariant.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      include: {
        product: { select: { name: true } },
        stockLevels: { select: { quantity: true } },
      },
      take: 50,
      orderBy: { updatedAt: "desc" },
    });

    // 3. Fetch recent marketplace orders (identified by FK sequence or external customer)
    recentOrders = await db.order.findMany({
      where: {
        tenantId: ctx.tenantId,
        OR: [
          { orderNumber: { contains: "-FK-" } },
          { addresses: { some: { line1: { contains: "Flipkart" } } } },
        ],
      },
      include: {
        customer: { select: { name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
  } catch (err) {
    logError("commerce: page load failed", err);
    return <ServiceUnavailableScreen />;
  }

  const availableVariants = variants.map((v) => ({
    id: v.id,
    sku: v.sku,
    name: `${v.product.name}${v.size ? ` (${v.size})` : ""}${v.colour ? ` - ${v.colour}` : ""}`,
    priceMinor: v.priceMinor,
    onHand: v.stockLevels.reduce((acc: number, sl: any) => acc + sl.quantity, 0),
  }));

  const recentMarketplaceOrders = recentOrders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    subtotalMinor: o.subtotalMinor,
    createdAt: o.createdAt.toISOString(),
    customerName: o.customer?.name ?? "Flipkart Buyer",
    itemsCount: o._count.items,
  }));

  // Serialize channel data for Client Component
  const serializedChannels = channels.map((c) => ({
    ...c,
    channel: {
      ...c.channel,
      createdAt: c.channel.createdAt.toISOString(),
      updatedAt: c.channel.updatedAt.toISOString(),
      lastSyncAt: c.channel.lastSyncAt ? c.channel.lastSyncAt.toISOString() : null,
    },
  }));

  return (
    <div className="w-full min-w-0 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Marketplace & Commerce"
        subtitle="Manage Flipkart seller integration, catalog FSN mappings, stock allocation buffers, and inbound marketplace orders."
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Commerce", href: "/commerce" },
        ]}
      />

      <CommerceClient
        initialChannels={serializedChannels}
        availableVariants={availableVariants}
        recentMarketplaceOrders={recentMarketplaceOrders}
      />
    </div>
  );
}
