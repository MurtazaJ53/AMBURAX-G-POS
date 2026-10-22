-- Draft ERPNext Purchase Invoice made from each purchase receipt (owner + CA approved 2026-10-14).
ALTER TABLE "purchase_receipts" ADD COLUMN "erpnextInvoiceName" TEXT;
