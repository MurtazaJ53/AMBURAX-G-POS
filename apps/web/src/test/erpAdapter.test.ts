import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The ERP adapter boundary, tested without an ERPNext server existing anywhere.
 *
 * Every failure mode is produced by `FakeErpTransport`. Nothing here installs, vendors, clones
 * or contacts ERPNext, and the suite would pass on a machine that has never heard of Frappe —
 * which is the point: a boundary whose tests need the far side running is a boundary nobody
 * verifies.
 *
 * The database is mocked too. `resolveErpEnvironment` reads `Tenant.erpnextSiteId`, and the
 * isolation property worth proving here is that a caller cannot name a site at all — a property
 * of the function's shape, not of PostgreSQL.
 */

const mockDb = { tenant: { findUnique: vi.fn() } };
vi.mock("@/server/db", () => ({ db: mockDb }));

const { ErpError, categoryOf, isRetryable, kindFromHttpStatus } = await import(
  "@/server/erp/errors"
);
const { EnvErpCredentialProvider, resolveErpEnvironment } = await import("@/server/erp/config");
const { FakeErpTransport } = await import("@/server/erp/fakeTransport");
const { ErpClient } = await import("@/server/erp/client");
const { checkErpHealth } = await import("@/server/erp/health");

const ENV = {
  tenantId: "t-a",
  siteId: "site-a",
  clusterId: null,
  companyId: null,
  version: null,
};

const CONTEXT = { tenantId: "t-a", correlationId: "corr-1" };

/** Credentials that never come from, or reach, a database. */
const staticCredentials = {
  credentialsFor: async () => ({
    baseUrl: "https://erp.example.invalid",
    apiKey: "key-abc",
    apiSecret: "secret-xyz",
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------------------------
// Error model
// ---------------------------------------------------------------------------------------------

describe("the normalized error model", () => {
  it("maps every kind to one of the five frozen categories", () => {
    const kinds = [
      "authentication_failed",
      "authorization_failed",
      "not_found",
      "validation_failed",
      "conflict",
      "rate_limited",
      "timeout",
      "unavailable",
      "server_error",
      "unsupported_version",
      "malformed_response",
      "not_provisioned",
      "configuration_error",
    ] as const;

    const frozen = [
      "ErpUnavailable",
      "ErpRejected",
      "ErpConflict",
      "ErpNotProvisioned",
      "ErpVersionUnsupported",
    ];

    for (const kind of kinds) {
      expect(frozen).toContain(categoryOf(kind));
    }
  });

  /**
   * Credentials that are wrong stay wrong. Retrying them burns the ERP's rate budget and hides
   * the real problem behind a queue that never drains.
   */
  it("treats authentication and authorization as refusals, not outages", () => {
    expect(categoryOf("authentication_failed")).toBe("ErpRejected");
    expect(categoryOf("authorization_failed")).toBe("ErpRejected");
    expect(isRetryable("authentication_failed")).toBe(false);
    expect(isRetryable("authorization_failed")).toBe(false);
  });

  it("classifies retryable failures", () => {
    for (const kind of ["rate_limited", "timeout", "unavailable", "server_error"] as const) {
      expect(isRetryable(kind)).toBe(true);
    }
  });

  it("classifies non-retryable failures", () => {
    for (const kind of [
      "validation_failed",
      "conflict",
      "not_found",
      "unsupported_version",
      "not_provisioned",
      "configuration_error",
    ] as const) {
      expect(isRetryable(kind)).toBe(false);
    }
  });

  /** The rule the disaster-recovery document states, made structural. */
  it("marks a timeout ambiguous, so it can never be read as success", () => {
    const err = new ErpError({ kind: "timeout", message: "timed out" });
    expect(err.ambiguous).toBe(true);
    expect(err.category).toBe("ErpUnavailable");
    expect(err.retryable).toBe(true);
  });

  it("does not mark an explicit refusal ambiguous", () => {
    expect(new ErpError({ kind: "validation_failed", message: "no" }).ambiguous).toBe(false);
  });

  it("maps HTTP statuses conservatively", () => {
    expect(kindFromHttpStatus(401)).toBe("authentication_failed");
    expect(kindFromHttpStatus(403)).toBe("authorization_failed");
    expect(kindFromHttpStatus(404)).toBe("not_found");
    expect(kindFromHttpStatus(409)).toBe("conflict");
    expect(kindFromHttpStatus(422)).toBe("validation_failed");
    expect(kindFromHttpStatus(429)).toBe("rate_limited");
    expect(kindFromHttpStatus(503)).toBe("unavailable");
    expect(kindFromHttpStatus(500)).toBe("server_error");
    // An unrecognised 4xx is refused rather than retried; an unrecognised 5xx is retried.
    expect(isRetryable(kindFromHttpStatus(418))).toBe(false);
    expect(isRetryable(kindFromHttpStatus(507))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Configuration and tenant resolution
// ---------------------------------------------------------------------------------------------

describe("resolving a tenant's ERP environment", () => {
  it("returns the environment for a provisioned tenant", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      id: "t-a",
      erpnextSiteId: "site-a",
      erpnextProvisionStatus: "PROVISIONED",
    });

    const result = await resolveErpEnvironment("t-a");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.environment.siteId).toBe("site-a");
    expect(result.environment.tenantId).toBe("t-a");
  });

  /** Every tenant today. Reserved columns, no site — and the adapter says so plainly. */
  it("reports a tenant with no site as not provisioned", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      id: "t-a",
      erpnextSiteId: null,
      erpnextProvisionStatus: "NOT_PROVISIONED",
    });
    expect((await resolveErpEnvironment("t-a")).status).toBe("not_provisioned");
  });

  it("treats a half-provisioned site as not provisioned rather than usable", async () => {
    for (const status of ["PROVISIONING", "FAILED"]) {
      mockDb.tenant.findUnique.mockResolvedValue({
        id: "t-a",
        erpnextSiteId: "site-a",
        erpnextProvisionStatus: status,
      });
      expect((await resolveErpEnvironment("t-a")).status).toBe("not_provisioned");
    }
  });

  it("reports an unknown tenant as not found", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(null);
    expect((await resolveErpEnvironment("t-nope")).status).toBe("not_found");
  });

  /**
   * The isolation guarantee, structural rather than defensive: the function takes only a
   * tenantId and queries only that tenant's row. There is no site, cluster or company parameter
   * for a caller to aim elsewhere.
   */
  it("only ever reads the row of the tenant it was asked about", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      id: "t-a",
      erpnextSiteId: "site-a",
      erpnextProvisionStatus: "PROVISIONED",
    });

    await resolveErpEnvironment("t-a");
    expect(mockDb.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t-a" } }),
    );
  });

  it("gives tenant A an environment that names only tenant A", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      id: "t-a",
      erpnextSiteId: "site-a",
      erpnextProvisionStatus: "PROVISIONED",
    });
    const result = await resolveErpEnvironment("t-a");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.environment.tenantId).toBe("t-a");
    expect(result.environment.siteId).not.toBe("site-b");
  });
});

describe("credentials", () => {
  it("fails loudly when a site has no credentials configured", async () => {
    const provider = new EnvErpCredentialProvider();
    await expect(provider.credentialsFor(ENV)).rejects.toBeInstanceOf(ErpError);
    await expect(provider.credentialsFor(ENV)).rejects.toMatchObject({
      kind: "configuration_error",
    });
  });

  /** The error may name the site. It may not discuss what the value should have been. */
  it("names the site but never the missing value", async () => {
    const provider = new EnvErpCredentialProvider();
    await provider.credentialsFor(ENV).catch((err: unknown) => {
      const message = (err as Error).message;
      expect(message).toContain("site-a");
      expect(message).not.toMatch(/ERP_SITE_.*_SECRET=/);
    });
    expect.assertions(2);
  });
});

// ---------------------------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------------------------

describe("the ERP client", () => {
  function client(transport: InstanceType<typeof FakeErpTransport>, supportedVersions?: string[]) {
    return new ErpClient(transport, staticCredentials, { supportedVersions });
  }

  it("returns the response on success", async () => {
    const transport = new FakeErpTransport().script({
      kind: "respond",
      status: 200,
      body: { message: "pong" },
    });

    const response = await client(transport).call(ENV, CONTEXT, {
      method: "GET",
      path: "/api/method/frappe.ping",
    });
    expect(response.status).toBe(200);
  });

  it("propagates the correlation id and idempotency key to the transport", async () => {
    const transport = new FakeErpTransport();
    await client(transport).call(ENV, CONTEXT, {
      method: "POST",
      path: "/api/resource/Sales Invoice",
      idempotencyKey: "sale-42",
    });

    expect(transport.sent[0]!.correlationId).toBe("corr-1");
    expect(transport.sent[0]!.idempotencyKey).toBe("sale-42");
  });

  it.each([
    [401, "authentication_failed", "ErpRejected"],
    [403, "authorization_failed", "ErpRejected"],
    [404, "not_found", "ErpRejected"],
    [409, "conflict", "ErpConflict"],
    [422, "validation_failed", "ErpRejected"],
    [429, "rate_limited", "ErpUnavailable"],
    [500, "server_error", "ErpUnavailable"],
    [503, "unavailable", "ErpUnavailable"],
  ])("normalizes HTTP %i to %s", async (status, kind, category) => {
    const transport = new FakeErpTransport().script({
      kind: "respond",
      status: status as number,
      body: {},
    });

    await expect(
      client(transport).call(ENV, CONTEXT, { method: "GET", path: "/x" }),
    ).rejects.toMatchObject({ kind, category });
  });

  it("normalizes a timeout, and keeps it ambiguous", async () => {
    const transport = new FakeErpTransport().script({ kind: "timeout" });

    await expect(
      client(transport).call(ENV, CONTEXT, { method: "POST", path: "/x", idempotencyKey: "k" }),
    ).rejects.toMatchObject({ kind: "timeout", category: "ErpUnavailable", ambiguous: true });
  });

  it("normalizes a dropped connection to unavailable", async () => {
    const transport = new FakeErpTransport().script({ kind: "connection" });
    await expect(
      client(transport).call(ENV, CONTEXT, { method: "GET", path: "/x" }),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  /** A 200 carrying a proxy error page is not a success, however much it looks like one. */
  it("rejects a malformed body even with a 200 status", async () => {
    const transport = new FakeErpTransport().script({ kind: "malformed" });
    await expect(
      client(transport).call(ENV, CONTEXT, { method: "GET", path: "/x" }),
    ).rejects.toMatchObject({ kind: "malformed_response", ambiguous: true });
  });

  it("refuses a site whose version is outside the supported range", async () => {
    const transport = new FakeErpTransport();
    const versioned = { ...ENV, version: "v14" };

    await expect(
      client(transport, ["v15"]).call(versioned, CONTEXT, { method: "GET", path: "/x" }),
    ).rejects.toMatchObject({ kind: "unsupported_version", category: "ErpVersionUnsupported" });

    // Refused before anything was sent.
    expect(transport.sent).toHaveLength(0);
  });

  /** No version has been pinned for this product, so no assertion is made. */
  it("performs no version assertion when nothing is pinned", async () => {
    const transport = new FakeErpTransport();
    const versioned = { ...ENV, version: "v99" };
    const response = await client(transport).call(versioned, CONTEXT, {
      method: "GET",
      path: "/x",
    });
    expect(response.status).toBe(200);
  });

  /** A context and an environment belonging to different tenants is a defect, not a request. */
  it("refuses a call whose environment belongs to another tenant", async () => {
    const transport = new FakeErpTransport();
    await expect(
      client(transport).call(
        ENV,
        { tenantId: "t-b", correlationId: "corr-2" },
        { method: "GET", path: "/x" },
      ),
    ).rejects.toMatchObject({ kind: "configuration_error" });
    expect(transport.sent).toHaveLength(0);
  });

  it("does not retry on its own", async () => {
    const transport = new FakeErpTransport().always({ kind: "timeout" });
    await expect(
      client(transport).call(ENV, CONTEXT, { method: "GET", path: "/x" }),
    ).rejects.toBeInstanceOf(ErpError);

    // One attempt. Retrying is the outbox dispatcher's job, with backoff.
    expect(transport.sent).toHaveLength(1);
  });

  it("reports telemetry without payloads or credentials", async () => {
    const seen: Record<string, unknown>[] = [];
    const transport = new FakeErpTransport();
    const withTelemetry = new ErpClient(transport, staticCredentials, {
      onTelemetry: (t) => seen.push(t as unknown as Record<string, unknown>),
    });

    await withTelemetry.call(ENV, CONTEXT, {
      method: "POST",
      path: "/api/resource/Sales Invoice",
      body: { customer: "Very Secret Customer Name" },
      idempotencyKey: "sale-42",
    });

    expect(seen).toHaveLength(1);
    const entry = JSON.stringify(seen[0]);
    expect(entry).toContain("corr-1");
    expect(entry).toContain("site-a");
    expect(entry).not.toContain("Very Secret Customer Name");
    expect(entry).not.toContain("secret-xyz");
    expect(entry).not.toContain("key-abc");
  });

  /** An ERP error message must never carry a credential out through the boundary. */
  it("redacts secrets that appear in an upstream error message", async () => {
    const leaky = {
      async send(): Promise<never> {
        throw new Error(
          "connect failed: https://user:hunter2@erp.example.invalid apiKey=key-abc",
        );
      },
    };
    const leakyClient = new ErpClient(leaky, staticCredentials);

    await leakyClient.call(ENV, CONTEXT, { method: "GET", path: "/x" }).catch((err: unknown) => {
      const message = (err as Error).message;
      expect(message).not.toContain("hunter2");
      expect(message).not.toContain("key-abc");
    });
    expect.assertions(2);
  });

  /** The failure body is not forwarded: an ERP validation message can quote a customer's data. */
  it("does not forward the ERP's response body in the error", async () => {
    const transport = new FakeErpTransport().always({
      kind: "respond",
      status: 422,
      body: { exception: "ValidationError: customer 'Acme Pvt Ltd' owes 50000" },
    });

    await client(transport)
      .call(ENV, CONTEXT, { method: "POST", path: "/x" })
      .catch((err: unknown) => {
        expect((err as InstanceType<typeof ErpError>).kind).toBe("validation_failed");
        expect((err as Error).message).not.toContain("Acme Pvt Ltd");
      });
    expect.assertions(2);
  });
});

// ---------------------------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------------------------

describe("the health contract", () => {
  it("reports not_provisioned for a tenant with no site", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      id: "t-a",
      erpnextSiteId: null,
      erpnextProvisionStatus: "NOT_PROVISIONED",
    });

    const health = await checkErpHealth({
      tenantId: "t-a",
      client: new ErpClient(new FakeErpTransport(), staticCredentials),
      correlationId: "corr-1",
    });
    expect(health.state).toBe("not_provisioned");
  });

  it("reports connected when the site answers", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      id: "t-a",
      erpnextSiteId: "site-a",
      erpnextProvisionStatus: "PROVISIONED",
    });

    const health = await checkErpHealth({
      tenantId: "t-a",
      client: new ErpClient(new FakeErpTransport(), staticCredentials),
      correlationId: "corr-1",
    });
    expect(health.state).toBe("connected");
    expect(health.siteId).toBe("site-a");
  });

  it.each([
    [401, "unauthenticated"],
    [503, "unavailable"],
  ])("maps a %i from the site to %s", async (status, expected) => {
    mockDb.tenant.findUnique.mockResolvedValue({
      id: "t-a",
      erpnextSiteId: "site-a",
      erpnextProvisionStatus: "PROVISIONED",
    });

    const transport = new FakeErpTransport().script({
      kind: "respond",
      status: status as number,
      body: {},
    });
    const health = await checkErpHealth({
      tenantId: "t-a",
      client: new ErpClient(transport, staticCredentials),
      correlationId: "corr-1",
    });
    expect(health.state).toBe(expected);
  });

  it("reports misconfigured when credentials are missing", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      id: "t-a",
      erpnextSiteId: "site-a",
      erpnextProvisionStatus: "PROVISIONED",
    });

    const health = await checkErpHealth({
      tenantId: "t-a",
      client: new ErpClient(new FakeErpTransport(), new EnvErpCredentialProvider()),
      correlationId: "corr-1",
    });
    expect(health.state).toBe("misconfigured");
  });

  /** A health check that writes is an outage of its own. */
  it("only ever issues a read", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      id: "t-a",
      erpnextSiteId: "site-a",
      erpnextProvisionStatus: "PROVISIONED",
    });

    const transport = new FakeErpTransport();
    await checkErpHealth({
      tenantId: "t-a",
      client: new ErpClient(transport, staticCredentials),
      correlationId: "corr-1",
    });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.method).toBe("GET");
    expect(transport.sent[0]!.idempotencyKey).toBeUndefined();
  });
});
