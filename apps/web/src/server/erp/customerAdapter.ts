import { db } from "@/server/db";
import { ErpClient } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider } from "@/server/erp/config";
import type { ErpEnvironment } from "@/server/erp/config";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport } from "@/server/erp/transport";

export class ErpCustomerAdapter {
  private client: ErpClient;

  constructor(transport?: ErpTransport) {
    this.client = new ErpClient(
      transport ?? new HttpErpTransport(),
      new EnvErpCredentialProvider(),
      {}
    );
  }

  /**
   * Find an existing ERPNext Customer by AMBURAX customer CUID (`customer_pos_id`).
   * `customer_pos_id` is a standard Frappe/ERPNext field on the Customer DocType.
   */
  private async lookupCustomer(
    env: ErpEnvironment,
    tenantId: string,
    customerId: string,
    correlationId: string
  ): Promise<{ name: string; customer_name?: string; mobile_no?: string; email_id?: string } | null> {
    const filters = JSON.stringify([["customer_pos_id", "=", customerId]]);
    const fields = JSON.stringify(["name", "customer_name", "mobile_no", "email_id"]);
    const path = `/api/resource/Customer?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}`;

    try {
      const response = await this.client.call(
        env,
        { tenantId, correlationId, causationId: customerId },
        { method: "GET", path }
      );

      const body = response.body as { data?: Array<{ name: string; customer_name?: string; mobile_no?: string; email_id?: string }> };
      const data = body?.data;

      if (!Array.isArray(data) || data.length === 0) {
        return null;
      }

      return data[0] ?? null;
    } catch (error) {
      if (error instanceof ErpError && error.kind === "not_found") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Synchronize an AMBURAX Customer to ERPNext.
   *
   * Idempotent:
   * - If an ERPNext Customer with matching `customer_pos_id` exists:
   *   Updates fields if modified and returns existing record.
   * - If not found:
   *   Creates a new ERPNext Customer document and returns its name.
   */
  public async syncCustomer(
    tenantId: string,
    customerId: string,
    correlationId: string
  ): Promise<string> {
    const customer = await db.customer.findUnique({
      where: { id: customerId, tenantId },
    });

    if (!customer) {
      throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
    }

    const envResult = await resolveErpEnvironment(tenantId);
    if (envResult.status !== "ok") {
      throw new ErpError({
        kind: "configuration_error",
        message: `ERP environment not provisioned for tenant ${tenantId}. Status: ${envResult.status}`,
        correlationId,
      });
    }

    const env = envResult.environment;

    // ── Idempotency check ────────────────────────────────────────────────────
    const existing = await this.lookupCustomer(env, tenantId, customer.id, correlationId);

    if (existing) {
      // If customer exists, update fields if different
      const updateDoc: Record<string, unknown> = {};
      if (customer.name && customer.name !== existing.customer_name) {
        updateDoc["customer_name"] = customer.name;
      }
      if (customer.phone && customer.phone !== existing.mobile_no) {
        updateDoc["mobile_no"] = customer.phone;
      }
      if (customer.email && customer.email !== existing.email_id) {
        updateDoc["email_id"] = customer.email;
      }

      if (Object.keys(updateDoc).length > 0) {
        await this.client.call(
          env,
          { tenantId, correlationId, causationId: customer.id },
          {
            method: "PUT",
            path: `/api/resource/Customer/${encodeURIComponent(existing.name)}`,
            body: updateDoc,
          }
        );
      }

      return existing.name;
    }

    // ── Create ERPNext Customer ──────────────────────────────────────────────
    const customerDoc: Record<string, unknown> = {
      doctype: "Customer",
      customer_name: customer.name,
      customer_type: customer.customerType === "WHOLESALE" || customer.customerType === "DISTRIBUTOR" ? "Company" : "Individual",
      customer_group: "Individual",
      territory: "All Territories",
      customer_pos_id: customer.id,
      mobile_no: customer.phone ?? undefined,
      email_id: customer.email ?? undefined,
    };

    const response = await this.client.call(
      env,
      { tenantId, correlationId, causationId: customer.id },
      {
        method: "POST",
        path: "/api/resource/Customer",
        body: customerDoc,
        idempotencyKey: customer.id,
      }
    );

    if (response.status !== 200 && response.status !== 201) {
      throw new ErpError({
        kind: "server_error",
        message: `Failed to create Customer on ERPNext: HTTP ${response.status}`,
        correlationId,
      });
    }

    const created = (response.body as { data?: { name?: string } })?.data;
    return created?.name ?? customer.name;
  }
}
