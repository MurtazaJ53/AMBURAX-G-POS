import { db } from "@/server/db";
import { ErpClient } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider } from "@/server/erp/config";
import { requireCompany } from "@/server/erp/documentSync";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import type { ErpTransport } from "@/server/erp/transport";
import { ErpError } from "./errors";

export const TENANT_GST_REGISTERED_EVENT = "TenantGstRegistered";

/**
 * GSTIN -> ERPNext Company (owner 2026-10-16). When a business turns GST on in AMBURAX, its
 * ERPNext Company gets the same GSTIN (`tax_id`, and India Compliance's `gstin` / `gst_category`;
 * ERPNext ignores those where India Compliance isn't installed). Re-running is harmless.
 */
export class ErpCompanyGstAdapter {
  private client: ErpClient;

  constructor(transport?: ErpTransport) {
    this.client = new ErpClient(transport ?? new HttpErpTransport(), new EnvErpCredentialProvider());
  }

  async syncCompanyGstin(tenantId: string, correlationId: string): Promise<void> {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { taxId: true } });
    const gstin = tenant?.taxId?.trim().toUpperCase();
    if (!gstin) return;
    const envResult = await resolveErpEnvironment(tenantId);
    if (envResult.status !== "ok") {
      throw new ErpError({ kind: "configuration_error", message: "This business isn't connected to ERPNext yet.", correlationId });
    }
    const company = requireCompany(envResult.environment, correlationId);
    const env = envResult.environment;
    const ctx = { tenantId, correlationId, causationId: tenantId };
    await this.client.call(env, ctx, {
      method: "PUT",
      path: `/api/resource/Company/${encodeURIComponent(company)}`,
      body: { tax_id: gstin, gstin, gst_category: "Registered Regular" },
    });

    // India Compliance reads the company's GSTIN from its own Address. Update the existing
    // company address, or create one from the main store's address.
    const filters = encodeURIComponent(
      JSON.stringify([
        ["Dynamic Link", "link_doctype", "=", "Company"],
        ["Dynamic Link", "link_name", "=", company],
        ["is_your_company_address", "=", 1],
      ]),
    );
    const found = await this.client.call(env, ctx, {
      method: "GET",
      path: `/api/resource/Address?filters=${filters}&fields=${encodeURIComponent(JSON.stringify(["name"]))}`,
    });
    const existing = (found.body as { data?: { name?: string }[] })?.data?.[0]?.name;
    if (existing) {
      await this.client.call(env, ctx, {
        method: "PUT",
        path: `/api/resource/Address/${encodeURIComponent(existing)}`,
        body: { gstin, gst_category: "Registered Regular" },
      });
      return;
    }
    const store = await db.store.findFirst({
      where: { tenantId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { addressLine: true, city: true, state: true, postalCode: true, phone: true },
    });
    if (!store) return;
    await this.client.call(env, ctx, {
      method: "POST",
      path: "/api/resource/Address",
      body: {
        address_title: company,
        address_type: "Billing",
        address_line1: store.addressLine,
        city: store.city,
        state: store.state,
        pincode: store.postalCode ?? undefined,
        phone: store.phone ?? undefined,
        country: "India",
        gstin,
        gst_category: "Registered Regular",
        is_your_company_address: 1,
        is_primary_address: 1,
        links: [{ link_doctype: "Company", link_name: company }],
      },
    });
  }
}
