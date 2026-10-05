import { ErpSaleAdapter } from "@/server/erp/saleAdapter";
import { ErpCatalogAdapter } from "@/server/erp/catalogAdapter";
import type { PublishableEvent, OutboxPublisher } from "@/server/events/publisher";

export class ErpOutboxPublisher implements OutboxPublisher {
  constructor(
    private saleAdapter = new ErpSaleAdapter(),
    private catalogAdapter = new ErpCatalogAdapter()
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
    }
  }
}
