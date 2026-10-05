import { ErpSaleAdapter } from "@/server/erp/saleAdapter";
import type { PublishableEvent, OutboxPublisher } from "@/server/events/publisher";

export class ErpOutboxPublisher implements OutboxPublisher {
  constructor(private saleAdapter = new ErpSaleAdapter()) {}

  async publish(event: PublishableEvent): Promise<void> {
    if (event.eventType === "SaleCompleted") {
      if (!event.entityId) {
        throw new Error("SaleCompleted event missing entityId");
      }
      await this.saleAdapter.syncSale(event.tenantId, event.entityId, event.correlationId);
    }
    // Ignore other events for now, or add more adapters here as needed
  }
}
