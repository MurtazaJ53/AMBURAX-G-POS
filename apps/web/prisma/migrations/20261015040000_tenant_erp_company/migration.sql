-- ADR-077/078: a business links to exactly one ERPNext Company, set by provisioning.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "erpnextCompanyId" TEXT,
ADD COLUMN     "erpnextProvisionError" TEXT,
ADD COLUMN     "erpnextProvisionedAt" TIMESTAMP(3);
