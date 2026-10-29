import { ErpSaleAdapter } from "@/server/erp/saleAdapter";
import { ErpCatalogAdapter } from "@/server/erp/catalogAdapter";
import { ErpStoreAdapter } from "@/server/erp/storeAdapter";
import { ErpInventoryAdapter } from "@/server/erp/inventoryAdapter";
import { ErpCustomerAdapter } from "@/server/erp/customerAdapter";
import { ErpPaymentAdapter } from "@/server/erp/paymentAdapter";
import { ErpReturnAdapter } from "@/server/erp/returnAdapter";
import { ErpSupplierAdapter } from "@/server/erp/supplierAdapter";
import { ErpPurchaseAdapter } from "@/server/erp/purchaseAdapter";
import { ErpTransferAdapter } from "@/server/erp/transferAdapter";
import { ErpReplenishmentAdapter } from "@/server/erp/replenishmentAdapter";
import { ErpTillVarianceAdapter } from "@/server/erp/tillVarianceAdapter";
import { TENANT_PROVISION_EVENT, TenantProvisioner } from "@/server/erp/tenantProvisioning";
import { ErpCompanyGstAdapter, TENANT_GST_REGISTERED_EVENT } from "@/server/erp/companyGstAdapter";
import type { PublishableEvent, OutboxPublisher } from "@/server/events/publisher";
import { db } from "@/server/db";
import { ErpError } from "@/server/erp/errors";

export class ErpOutboxPublisher implements OutboxPublisher {
  constructor(
    private saleAdapter = new ErpSaleAdapter(),
    private catalogAdapter = new ErpCatalogAdapter(),
    private storeAdapter = new ErpStoreAdapter(),
    private inventoryAdapter = new ErpInventoryAdapter(),
    private customerAdapter = new ErpCustomerAdapter(),
    private paymentAdapter = new ErpPaymentAdapter(),
    private returnAdapter = new ErpReturnAdapter(),
    private supplierAdapter = new ErpSupplierAdapter(),
    private purchaseAdapter = new ErpPurchaseAdapter(),
    private transferAdapter = new ErpTransferAdapter(),
    private replenishmentAdapter = new ErpReplenishmentAdapter(),
    private tillVarianceAdapter = new ErpTillVarianceAdapter(),
    private tenantProvisioner = new TenantProvisioner(),
    private companyGstAdapter = new ErpCompanyGstAdapter()
  ) {}

  async publish(event: PublishableEvent): Promise<void> {
    const tenant = await db.tenant.findUnique({
      where: { id: event.tenantId },
      select: { erpnextSiteId: true },
    });
    if (!tenant?.erpnextSiteId) {
      throw new ErpError({
        kind: "configuration_error",
        message: `Tenant ${event.tenantId} has no ERP site configured and cannot publish outbox events.`,
        correlationId: event.correlationId,
      });
    }

    if (event.eventType === "SaleCompleted") {
      if (!event.entityId) {
        throw new Error("SaleCompleted event missing entityId");
      }
      await this.saleAdapter.syncSale(event.tenantId, event.entityId, event.correlationId);
    } else if (event.eventType === "ProductVariantCreated" || event.eventType === "ProductVariantUpdated") {
      if (!event.entityId) {
        throw new Error(`${event.eventType} event missing entityId`);
      }
      await this.catalogAdapter.syncVariant(event.tenantId, event.entityId, event.correlationId);
    } else if (event.eventType === TENANT_PROVISION_EVENT) {
      await this.tenantProvisioner.provision(event.tenantId, event.correlationId);
    } else if (event.eventType === "StoreCreated") {
      if (!event.entityId) {
        throw new Error("StoreCreated event missing entityId");
      }
      await this.storeAdapter.syncStore(event.tenantId, event.entityId, event.correlationId);
    } else if (event.eventType === "StockMovementCreated") {
      if (!event.entityId) {
        throw new Error("StockMovementCreated event missing entityId");
      }
      await this.inventoryAdapter.syncMovement(event.tenantId, event.entityId, event.correlationId);
    } else if (event.eventType === "CustomerCreated" || event.eventType === "CustomerUpdated") {
      if (!event.entityId) {
        throw new Error(`${event.eventType} event missing entityId`);
      }
      await this.customerAdapter.syncCustomer(event.tenantId, event.entityId, event.correlationId);
    } else if (event.eventType === "CustomerPaymentCollected") {
      if (!event.entityId) {
        throw new Error("CustomerPaymentCollected event missing entityId");
      }
      await this.paymentAdapter.syncPayment(event.tenantId, event.entityId, event.correlationId);
    } else if (event.eventType === "SaleReturnCreated") {
      if (!event.entityId) {
        throw new Error("SaleReturnCreated event missing entityId");
      }
      await this.returnAdapter.syncReturn(event.tenantId, event.entityId, event.correlationId);
    } else if (event.eventType === "SaleVoided") {
      if (!event.entityId) {
        throw new Error("SaleVoided event missing entityId");
      }
      await this.saleAdapter.cancelInvoice(event.tenantId, event.entityId, event.correlationId);
    } else if (event.eventType === "SupplierCreated" || event.eventType === "SupplierUpdated") {
      if (!event.entityId) {
        throw new Error(`${event.eventType} event missing entityId`);
      }
      await this.supplierAdapter.syncSupplier(event.tenantId, event.entityId, event.correlationId);
    } else if (event.eventType === "PurchaseReceiptCreated") {
      if (!event.entityId) {
        throw new Error("PurchaseReceiptCreated event missing entityId");
      }
      await this.purchaseAdapter.syncReceipt(event.tenantId, event.entityId, event.correlationId);
    } else if (event.eventType === "PurchaseReturnCreated") {
      if (!event.entityId) {
        throw new Error("PurchaseReturnCreated event missing entityId");
      }
      await this.purchaseAdapter.syncReturn(event.tenantId, event.entityId, event.correlationId);
    } else if (
      event.eventType === "StockTransferSent" ||
      event.eventType === "StockTransferReceived" ||
      event.eventType === "StockTransferCancelled"
    ) {
      if (!event.entityId) {
        throw new Error(`${event.eventType} event missing entityId`);
      }
      if (event.eventType === "StockTransferSent") {
        await this.transferAdapter.syncSent(event.tenantId, event.entityId, event.correlationId);
      } else if (event.eventType === "StockTransferReceived") {
        await this.transferAdapter.syncReceived(event.tenantId, event.entityId, event.correlationId);
      } else {
        await this.transferAdapter.syncCancelled(event.tenantId, event.entityId, event.correlationId);
      }
    } else if (event.eventType === "PurchaseOrderCreated") {
      if (!event.entityId) {
        throw new Error("PurchaseOrderCreated event missing entityId");
      }
      await this.purchaseAdapter.syncOrder(event.tenantId, event.entityId, event.correlationId);
    } else if (event.eventType === "PurchaseOrderCancelled") {
      if (!event.entityId) {
        throw new Error("PurchaseOrderCancelled event missing entityId");
      }
      await this.purchaseAdapter.cancelOrder(event.tenantId, event.entityId, event.correlationId);
    } else if (event.eventType === "ReorderRuleSet") {
      if (!event.entityId || !event.storeId) {
        throw new Error("ReorderRuleSet event missing entityId or storeId");
      }
      await this.replenishmentAdapter.syncRule(event.tenantId, event.storeId, event.entityId, event.correlationId);
    } else if (event.eventType === "TillVarianceApproved") {
      if (!event.entityId) {
        throw new Error("TillVarianceApproved event missing entityId");
      }
      await this.tillVarianceAdapter.syncVariance(event.tenantId, event.entityId, event.correlationId);
    } else if (event.eventType === "ReplenishmentRequested") {
      if (!event.entityId) {
        throw new Error("ReplenishmentRequested event missing entityId");
      }
      await this.replenishmentAdapter.syncRequest(event.tenantId, event.entityId, event.correlationId);
    } else if (event.eventType === TENANT_GST_REGISTERED_EVENT) {
      await this.companyGstAdapter.syncCompanyGstin(event.tenantId, event.correlationId);
    }
  }
}
