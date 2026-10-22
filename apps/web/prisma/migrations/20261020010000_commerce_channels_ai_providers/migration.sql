-- Marketplace channels (listings, sync jobs) and Gemini/OpenAI keys: they were in schema.prisma without a migration.
-- The four updatedAt default drops are deliberately left out (open decision in latter.md).

-- CreateEnum
CREATE TYPE "CommercePlatform" AS ENUM ('FLIPKART', 'AMAZON', 'SHOPIFY', 'MEESHO', 'WOOCOMMERCE');

-- CreateEnum
CREATE TYPE "ChannelListingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'OUT_OF_STOCK', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncJobType" AS ENUM ('LISTINGS_PUSH', 'INVENTORY_SYNC', 'ORDERS_PULL', 'PRICE_SYNC');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "geminiKeyCipher" TEXT,
ADD COLUMN     "geminiKeyLast4" TEXT,
ADD COLUMN     "openaiKeyCipher" TEXT,
ADD COLUMN     "openaiKeyLast4" TEXT;

-- CreateTable
CREATE TABLE "commerce_channels" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" "CommercePlatform" NOT NULL DEFAULT 'FLIPKART',
    "name" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "appSecretCipher" TEXT,
    "accessTokenCipher" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "storeId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_listings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "externalListingId" TEXT,
    "sellerSku" TEXT NOT NULL,
    "status" "ChannelListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "channelPriceMinor" INTEGER,
    "stockAllocation" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedStock" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_sync_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "type" "SyncJobType" NOT NULL,
    "status" "SyncJobStatus" NOT NULL,
    "itemsCount" INTEGER NOT NULL DEFAULT 0,
    "details" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commerce_channels_tenantId_platform_idx" ON "commerce_channels"("tenantId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_channels_tenantId_platform_sellerId_key" ON "commerce_channels"("tenantId", "platform", "sellerId");

-- CreateIndex
CREATE INDEX "channel_listings_tenantId_channelId_idx" ON "channel_listings"("tenantId", "channelId");

-- CreateIndex
CREATE INDEX "channel_listings_tenantId_variantId_idx" ON "channel_listings"("tenantId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_listings_channelId_sellerSku_key" ON "channel_listings"("channelId", "sellerSku");

-- CreateIndex
CREATE INDEX "commerce_sync_logs_tenantId_channelId_createdAt_idx" ON "commerce_sync_logs"("tenantId", "channelId", "createdAt");

-- AddForeignKey
ALTER TABLE "commerce_channels" ADD CONSTRAINT "commerce_channels_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_listings" ADD CONSTRAINT "channel_listings_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "commerce_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_listings" ADD CONSTRAINT "channel_listings_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_sync_logs" ADD CONSTRAINT "commerce_sync_logs_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "commerce_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

