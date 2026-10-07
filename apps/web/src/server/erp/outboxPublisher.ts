import { ErpSaleAdapter } from "@/server/erp/saleAdapter";
import { ErpCatalogAdapter } from "@/server/erp/catalogAdapter";
import { ErpStoreAdapter } from "@/server/erp/storeAdapter";
import { ErpInventoryAdapter } from "@/server/erp/inventoryAdapter";
import { ErpCustomerAdapter } from "@/server/erp/customerAdapter";
import type { PublishableEvent, OutboxPublisher } from "@/server/events/publisher";

export class ErpOutboxPublisher implements OutboxPublisher {
  constructor(
    private saleAdapter = new ErpSaleAdapter(),
    private catalogAdapter = new ErpCatalogAdapter(),
    private storeAdapter = new ErpStoreAdapter(),
    private inventoryAdapter = new ErpInventoryAdapter(),
    private customerAdapter = new ErpCustomerAdapter()
  ) {}

  async publish(event: PublishableEvent): Promise<void> {
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
    }
  }
}
