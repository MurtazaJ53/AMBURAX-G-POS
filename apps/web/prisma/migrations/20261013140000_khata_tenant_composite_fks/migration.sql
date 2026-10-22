-- Tenant-composite foreign keys for the Khata ledger.
--
-- Six links pointed at their parent by id alone, so the database could not refuse a row that
-- referenced another tenant's payment, allocation or return. Each becomes (id, tenantId), the
-- rule every other tenant-scoped link already follows. Same names, same delete rules; no data
-- changes meaning, and existing rows already satisfy the stricter key.

CREATE UNIQUE INDEX "uq_kp_id_tenant" ON "khata_payments"("id", "tenantId");
CREATE UNIQUE INDEX "uq_kpa_id_tenant" ON "khata_payment_allocations"("id", "tenantId");
CREATE UNIQUE INDEX "uq_kaa_id_tenant" ON "khata_advance_allocations"("id", "tenantId");
CREATE UNIQUE INDEX "uq_sr_id_tenant" ON "sale_returns"("id", "tenantId");

ALTER TABLE "khata_payment_allocations" DROP CONSTRAINT "fk_kpa_payment";
ALTER TABLE "khata_payment_allocations" ADD CONSTRAINT "fk_kpa_payment"
  FOREIGN KEY ("khataPaymentId", "tenantId") REFERENCES "khata_payments"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "khata_receivable_entries" DROP CONSTRAINT "fk_rec_payment_allocation";
ALTER TABLE "khata_receivable_entries" ADD CONSTRAINT "fk_rec_payment_allocation"
  FOREIGN KEY ("paymentAllocationId", "tenantId") REFERENCES "khata_payment_allocations"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "khata_receivable_entries" DROP CONSTRAINT "fk_rec_advance_allocation";
ALTER TABLE "khata_receivable_entries" ADD CONSTRAINT "fk_rec_advance_allocation"
  FOREIGN KEY ("allocationId", "tenantId") REFERENCES "khata_advance_allocations"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "khata_receivable_entries" DROP CONSTRAINT "fk_rec_sale_return";
ALTER TABLE "khata_receivable_entries" ADD CONSTRAINT "fk_rec_sale_return"
  FOREIGN KEY ("saleReturnId", "tenantId") REFERENCES "sale_returns"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "khata_advance_entries" DROP CONSTRAINT "fk_adv_khata_payment";
ALTER TABLE "khata_advance_entries" ADD CONSTRAINT "fk_adv_khata_payment"
  FOREIGN KEY ("khataPaymentId", "tenantId") REFERENCES "khata_payments"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "khata_advance_entries" DROP CONSTRAINT "fk_adv_advance_allocation";
ALTER TABLE "khata_advance_entries" ADD CONSTRAINT "fk_adv_advance_allocation"
  FOREIGN KEY ("allocationId", "tenantId") REFERENCES "khata_advance_allocations"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
