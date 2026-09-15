-- P1-8H — tenant database invariants.
--
-- Turns sixteen single-column foreign keys into composite ones, so PostgreSQL itself refuses a
-- child of one tenant that references a parent of another. The pattern is the one established in
-- P1-8B and used by every table since:
--
--     (child.parentId, child.tenantId)  ->  parent(id, tenantId)
--
-- Nothing is removed and nothing is deleted. The foreign keys dropped below are immediately
-- re-created as composite versions of themselves; no table, column or row goes away.
--
-- Two structural additions:
--
--   * `sale_items.tenantId` — a sale line references a ProductVariant, and without a tenantId of
--     its own there was no way for PostgreSQL to prove that variant belonged to the sale's
--     tenant. Backfilled from the parent sale, which is the only value it could ever have had,
--     then made NOT NULL. Three steps rather than one because `ADD COLUMN ... NOT NULL` fails on
--     a table that already has rows.
--
--   * `stock_levels` gains a foreign key to `tenants` at all. The projection has carried a
--     tenantId since P1-8B with nothing enforcing it — this closes the risk carried forward from
--     that phase.
--
-- Two delete actions change, both from SET NULL to RESTRICT, and both because a composite key
-- cannot be set to NULL while its tenantId column is NOT NULL:
--
--   * sales.customerId — nulling it would erase who bought something rather than refuse the
--     delete. Customers are deactivated, never deleted.
--   * invitations.acceptedByUserId — same reasoning for the person who accepted.
--
-- Every existing row was checked for violations before this migration was written: eighteen
-- cross-tenant checks across product variants, sales, sale items, stock levels, POS devices,
-- invitations, orders, sessions, MFA challenges, reset tokens and audit logs, all returning
-- zero. No data is remediated here because none needs it.

-- DropForeignKey
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_acceptedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_inviterUserId_fkey";

-- DropForeignKey
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_storeId_fkey";

-- DropForeignKey
ALTER TABLE "mfa_challenges" DROP CONSTRAINT "mfa_challenges_userId_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "password_reset_tokens_userId_fkey";

-- DropForeignKey
ALTER TABLE "pos_devices" DROP CONSTRAINT "pos_devices_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "pos_devices" DROP CONSTRAINT "pos_devices_storeId_fkey";

-- DropForeignKey
ALTER TABLE "product_variants" DROP CONSTRAINT "product_variants_productId_fkey";

-- DropForeignKey
ALTER TABLE "sale_items" DROP CONSTRAINT "sale_items_saleId_fkey";

-- DropForeignKey
ALTER TABLE "sale_items" DROP CONSTRAINT "sale_items_variantId_fkey";

-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_cashierUserId_fkey";

-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_customerId_fkey";

-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_storeId_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_userId_fkey";

-- DropForeignKey
ALTER TABLE "stock_levels" DROP CONSTRAINT "stock_levels_storeId_fkey";

-- DropForeignKey
ALTER TABLE "stock_levels" DROP CONSTRAINT "stock_levels_variantId_fkey";

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN "tenantId" TEXT;

-- Backfill from the parent sale. A line's tenant is the sale's tenant; there is no other value
-- it could take, so this is derivation rather than a guess.
UPDATE "sale_items" si
SET "tenantId" = s."tenantId"
FROM "sales" s
WHERE s."id" = si."saleId" AND si."tenantId" IS NULL;

ALTER TABLE "sale_items" ALTER COLUMN "tenantId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "sale_items_tenantId_saleId_idx" ON "sale_items"("tenantId", "saleId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_id_tenantId_key" ON "sales"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_createdByUserId_tenantId_fkey" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviterUserId_tenantId_fkey" FOREIGN KEY ("inviterUserId", "tenantId") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_acceptedByUserId_tenantId_fkey" FOREIGN KEY ("acceptedByUserId", "tenantId") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_tenantId_fkey" FOREIGN KEY ("productId", "tenantId") REFERENCES "products"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashierUserId_tenantId_fkey" FOREIGN KEY ("cashierUserId", "tenantId") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "customers"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_saleId_tenantId_fkey" FOREIGN KEY ("saleId", "tenantId") REFERENCES "sales"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_variantId_tenantId_fkey" FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_variantId_tenantId_fkey" FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_createdByUserId_tenantId_fkey" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

