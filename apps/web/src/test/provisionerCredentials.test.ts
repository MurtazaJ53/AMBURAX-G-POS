import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { EnvErpCredentialProvider, ProvisionerErpCredentialProvider, type ErpEnvironment } from "@/server/erp/config";

const env = (siteId: string): ErpEnvironment => ({ tenantId: "t1", siteId, clusterId: null, companyId: "Acme", version: null });
const A = env("site-a.local");
const SAVED = { ...process.env };

describe("provisioning credentials: the site's own provisioner keys or nothing", () => {
  beforeEach(() => {
    for (const [slug, id] of [["SITE_A_LOCAL", "a"], ["SITE_B_LOCAL", "b"]] as const) {
      process.env[`ERP_SITE_${slug}_URL`] = `http://site-${id}.local`;
      process.env[`ERP_SITE_${slug}_KEY`] = `integration-key-${id}`;
      process.env[`ERP_SITE_${slug}_SECRET`] = `integration-secret-${id}`;
      process.env[`ERP_SITE_${slug}_PROVISIONER_KEY`] = `prov-key-${id}`;
      process.env[`ERP_SITE_${slug}_PROVISIONER_SECRET`] = `prov-secret-${id}`;
    }
  });
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("provisioning uses the site URL with that site's provisioner keys", async () => {
    await expect(new ProvisionerErpCredentialProvider().credentialsFor(A)).resolves.toEqual({
      baseUrl: "http://site-a.local",
      apiKey: "prov-key-a",
      apiSecret: "prov-secret-a",
    });
    await expect(new ProvisionerErpCredentialProvider().credentialsFor(env("site-b.local"))).resolves.toMatchObject({
      apiKey: "prov-key-b",
    });
  });

  it("day-to-day sync keeps using the integration keys", async () => {
    await expect(new EnvErpCredentialProvider().credentialsFor(A)).resolves.toMatchObject({
      apiKey: "integration-key-a",
      apiSecret: "integration-secret-a",
    });
  });

  it.each(["ERP_SITE_SITE_A_LOCAL_PROVISIONER_KEY", "ERP_SITE_SITE_A_LOCAL_PROVISIONER_SECRET"])(
    "fails clearly when %s is missing, never using the integration keys or another site's keys",
    async (missing) => {
      delete process.env[missing];
      const result = new ProvisionerErpCredentialProvider().credentialsFor(A);
      await expect(result).rejects.toThrow(/site site-a\.local: set ERP_SITE_SITE_A_LOCAL_PROVISIONER_KEY and ERP_SITE_SITE_A_LOCAL_PROVISIONER_SECRET/);
      await expect(result).rejects.toThrow(/never uses the integration keys or another site's keys/);
    },
  );

  it("the old global ERP_PROVISIONER_KEY is not read", async () => {
    delete process.env["ERP_SITE_SITE_A_LOCAL_PROVISIONER_KEY"];
    delete process.env["ERP_SITE_SITE_A_LOCAL_PROVISIONER_SECRET"];
    process.env["ERP_PROVISIONER_KEY"] = "global-key";
    process.env["ERP_PROVISIONER_SECRET"] = "global-secret";
    await expect(new ProvisionerErpCredentialProvider().credentialsFor(A)).rejects.toThrow(/not configured for site site-a\.local/);
  });

  it("never puts a key value in the error", async () => {
    delete process.env["ERP_SITE_SITE_A_LOCAL_PROVISIONER_SECRET"];
    const err = await new ProvisionerErpCredentialProvider().credentialsFor(A).catch((e: Error) => e);
    const message = String((err as Error).message);
    for (const value of ["prov-key-a", "prov-key-b", "integration-key-a"]) expect(message).not.toContain(value);
  });
});
