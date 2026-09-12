import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * P1-5 — onboarding resume decision logic.
 *
 * The pure functions are exhaustively covered here. Tenant isolation and the fact that the
 * decision is read from real rows are proven against PostgreSQL in
 * `src/test-integration/onboardingResume.test.ts` — an application-level `where tenantId`
 * clause is not a database guarantee, and this file does not pretend otherwise.
 */

const mockDb = {
  tenant: { findUnique: vi.fn() },
  store: { findFirst: vi.fn() },
};

vi.mock("@/server/db", () => ({ db: mockDb }));

const { onboardingResumePath, resolveOnboardingResume, getOnboardingResume } = await import(
  "@/server/onboarding/resume"
);

const ALL_STEPS = [
  "BUSINESS_CREATED",
  "OWNER_CREATED",
  "STORE_CREATED",
  "TEAM_INVITED",
  "POS_CONFIGURED",
  "COMPLETE",
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.store.findFirst.mockResolvedValue({ id: "store-1" });
});

describe("onboardingResumePath — the step mapping", () => {
  it("routes each resumable step to the screen that accepts it", () => {
    expect(onboardingResumePath("OWNER_CREATED")).toBe("/onboarding/store");
    expect(onboardingResumePath("STORE_CREATED")).toBe("/onboarding/team");
    expect(onboardingResumePath("TEAM_INVITED")).toBe("/onboarding/pos");
    expect(onboardingResumePath("POS_CONFIGURED")).toBe("/onboarding/complete");
  });

  it("returns null for COMPLETE — completion is final", () => {
    expect(onboardingResumePath("COMPLETE")).toBeNull();
  });

  it("returns null for BUSINESS_CREATED — no User exists to be signed in at that step", () => {
    expect(onboardingResumePath("BUSINESS_CREATED")).toBeNull();
  });

  it("returns null for an unrecognised value rather than guessing", () => {
    expect(onboardingResumePath("SOMETHING_ELSE")).toBeNull();
    expect(onboardingResumePath("")).toBeNull();
  });

  it("never routes to a page outside the onboarding flow", () => {
    for (const step of ALL_STEPS) {
      const path = onboardingResumePath(step);
      if (path) expect(path.startsWith("/onboarding/")).toBe(true);
    }
  });
});

describe("resolveOnboardingResume — guards on top of the mapping", () => {
  it("resumes an OWNER at every incomplete stage", () => {
    const cases: [string, string][] = [
      ["OWNER_CREATED", "/onboarding/store"],
      ["STORE_CREATED", "/onboarding/team"],
      ["TEAM_INVITED", "/onboarding/pos"],
      ["POS_CONFIGURED", "/onboarding/complete"],
    ];
    for (const [step, expected] of cases) {
      expect(
        resolveOnboardingResume({ tenantRole: "OWNER", onboardingStep: step, hasStore: true }).path,
      ).toBe(expected);
    }
  });

  it("never resumes a completed tenant", () => {
    const decision = resolveOnboardingResume({
      tenantRole: "OWNER",
      onboardingStep: "COMPLETE",
      hasStore: true,
    });
    expect(decision).toEqual({ path: null, inconsistent: false });
  });

  it("never resumes a STAFF user, at any step", () => {
    for (const step of ALL_STEPS) {
      expect(
        resolveOnboardingResume({ tenantRole: "STAFF", onboardingStep: step, hasStore: true }),
      ).toEqual({ path: null, inconsistent: false });
    }
  });

  it("refuses to resume — and reports it — when the step implies a Store that is missing", () => {
    // This is the redirect loop: /pos sends a storeless tenant to /store, which only
    // accepts OWNER_CREATED, which sends it back to /home.
    for (const step of ["STORE_CREATED", "TEAM_INVITED"]) {
      expect(
        resolveOnboardingResume({ tenantRole: "OWNER", onboardingStep: step, hasStore: false }),
      ).toEqual({ path: null, inconsistent: true });
    }
  });

  it("still routes POS_CONFIGURED with a missing store — A10 reports the corruption itself", () => {
    const decision = resolveOnboardingResume({
      tenantRole: "OWNER",
      onboardingStep: "POS_CONFIGURED",
      hasStore: false,
    });
    expect(decision).toEqual({ path: "/onboarding/complete", inconsistent: true });
  });

  it("does not flag a missing store as inconsistent before the store step", () => {
    for (const step of ["BUSINESS_CREATED", "OWNER_CREATED"]) {
      expect(
        resolveOnboardingResume({ tenantRole: "OWNER", onboardingStep: step, hasStore: false })
          .inconsistent,
      ).toBe(false);
    }
  });

  it("is idempotent — the same inputs always give the same decision", () => {
    const input = { tenantRole: "OWNER" as const, onboardingStep: "TEAM_INVITED", hasStore: true };
    const a = resolveOnboardingResume(input);
    const b = resolveOnboardingResume(input);
    const c = resolveOnboardingResume(input);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});

describe("getOnboardingResume — reads authoritative state", () => {
  it("scopes both reads to the caller's own tenant", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ onboardingStep: "STORE_CREATED" });

    await getOnboardingResume({ tenantId: "tenant-a", tenantRole: "OWNER" });

    expect(mockDb.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tenant-a" } }),
    );
    expect(mockDb.store.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tenant-a" } }),
    );
  });

  it("resolves the path from the stored step", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ onboardingStep: "OWNER_CREATED" });
    const decision = await getOnboardingResume({ tenantId: "tenant-a", tenantRole: "OWNER" });
    expect(decision.path).toBe("/onboarding/store");
  });

  it("short-circuits for STAFF without querying anything", async () => {
    const decision = await getOnboardingResume({ tenantId: "tenant-a", tenantRole: "STAFF" });

    expect(decision).toEqual({ path: null, inconsistent: false });
    expect(mockDb.tenant.findUnique).not.toHaveBeenCalled();
    expect(mockDb.store.findFirst).not.toHaveBeenCalled();
  });

  it("fails safely when the tenant row is missing", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(null);
    const decision = await getOnboardingResume({ tenantId: "ghost", tenantRole: "OWNER" });
    expect(decision).toEqual({ path: null, inconsistent: false });
  });

  it("propagates a datastore failure rather than silently not resuming", async () => {
    // The caller (/home) turns this into the ServiceUnavailable screen. Swallowing it here
    // would strand an owner on the placeholder with no explanation.
    mockDb.tenant.findUnique.mockRejectedValue(new Error("connection refused"));
    await expect(getOnboardingResume({ tenantId: "tenant-a", tenantRole: "OWNER" })).rejects.toThrow(
      "connection refused",
    );
  });

  it("repeated calls return the same decision — resume is a read, not a mutation", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ onboardingStep: "TEAM_INVITED" });

    const first = await getOnboardingResume({ tenantId: "tenant-a", tenantRole: "OWNER" });
    const second = await getOnboardingResume({ tenantId: "tenant-a", tenantRole: "OWNER" });

    expect(first).toEqual(second);
    expect(first.path).toBe("/onboarding/pos");
  });
});

describe("loop safety — every resume target accepts the step that routes to it", () => {
  // Encodes the guard each page actually enforces, so a future change to either side that
  // breaks the pairing fails here instead of becoming an infinite redirect in a browser.
  const TARGET_ACCEPTS: Record<string, (step: string) => boolean> = {
    "/onboarding/store": (s) => s === "OWNER_CREATED",
    "/onboarding/team": (s) => s === "STORE_CREATED",
    "/onboarding/pos": (s) => s === "STORE_CREATED" || s === "TEAM_INVITED",
    "/onboarding/complete": (s) => s === "POS_CONFIGURED" || s === "COMPLETE",
  };

  it("holds for every step that produces a redirect", () => {
    for (const step of ALL_STEPS) {
      const { path } = resolveOnboardingResume({
        tenantRole: "OWNER",
        onboardingStep: step,
        hasStore: true,
      });
      if (!path) continue;
      const accepts = TARGET_ACCEPTS[path];
      expect(accepts, `no guard recorded for ${path}`).toBeDefined();
      expect(accepts!(step), `${path} would bounce a tenant at ${step}`).toBe(true);
    }
  });
});
