import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { EnvErpCredentialProvider, ProvisionerErpCredentialProvider, type ErpEnvironment } from "@/server/erp/config";

const ENV: ErpEnvironment = { tenantId: "t1", siteId: "test-site.local", clusterId: null, companyId: "Acme", version: null };
const SAVED = { ...process.env };

describe("provisioning credentials: the provisioner's keys or nothing", () => {
  beforeEach(() => {
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "integration-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "integration-secret";
    process.env["ERP_PROVISIONER_KEY"] = "prov-key";
    process.env["ERP_PROVISIONER_SECRET"] = "prov-secret";
  });
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("provisioning uses the site URL with the provisioner keys", async () => {
    await expect(new ProvisionerErpCredentialProvider().credentialsFor(ENV)).resolves.toEqual({
      baseUrl: "http://test-site.local",
      apiKey: "prov-key",
      apiSecret: "prov-secret",
    });
  });

  it("day-to-day sync keeps using the integration keys", async () => {
    await expect(new EnvErpCredentialProvider().credentialsFor(ENV)).resolves.toMatchObject({
      apiKey: "integration-key",
      apiSecret: "integration-secret",
    });
  });

  it.each(["ERP_PROVISIONER_KEY", "ERP_PROVISIONER_SECRET"])(
    "fails with a clear error, and never falls back to the integration keys, when %s is missing",
    async (missing) => {
      delete process.env[missing];
      const result = new ProvisionerErpCredentialProvider().credentialsFor(ENV);
      await expect(result).rejects.toThrow(/ERP_PROVISIONER_KEY and ERP_PROVISIONER_SECRET/);
      await expect(result).rejects.toThrow(/never uses the integration keys/);
    },
  );

  it("never puts a key value in the error", async () => {
    delete process.env["ERP_PROVISIONER_SECRET"];
    const err = await new ProvisionerErpCredentialProvider().credentialsFor(ENV).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain("prov-key");
    expect(String((err as Error).message)).not.toContain("integration-key");
  });
});
