-- Snapshot of each sale line's GST type (owner B3, 2026-10-16).

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "taxTreatment" "GstTaxTreatment";
