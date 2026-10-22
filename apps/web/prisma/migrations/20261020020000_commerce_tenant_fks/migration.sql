-- Marketplace tables reference channels and variants by (id, tenantId), like every tenant-owned child.
-- The four updatedAt default drops are deliberately left out (open decision in latter.md).

-- DropForeignKey
ALTER TABLE "channel_listings" DROP CONSTRAINT "channel_listings_channelId_fkey";

-- DropForeignKey
ALTER TABLE "channel_listings" DROP CONSTRAINT "channel_listings_variantId_fkey";

-- DropForeignKey
ALTER TABLE "commerce_sync_logs" DROP CONSTRAINT "commerce_sync_logs_channelId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "commerce_channels_id_tenantId_key" ON "commerce_channels"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "channel_listings" ADD CONSTRAINT "channel_listings_channelId_tenantId_fkey" FOREIGN KEY ("channelId", "tenantId") REFERENCES "commerce_channels"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_listings" ADD CONSTRAINT "channel_listings_variantId_tenantId_fkey" FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_sync_logs" ADD CONSTRAINT "commerce_sync_logs_channelId_tenantId_fkey" FOREIGN KEY ("channelId", "tenantId") REFERENCES "commerce_channels"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

