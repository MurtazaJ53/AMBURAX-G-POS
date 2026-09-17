import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocked Prisma, same disclosed limitation as every other concurrency suite here: the
// lost-claim path is driven by making the conditional `updateMany` return count 0, which
// is what Postgres would do to the loser. No live database is available in this sandbox.

const mockDb = {
  posDevice: { findUnique: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(async (cb) => cb(mockDb)),
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/loginGuard", () => ({
  isIpRateLimited: vi.fn(async () => false),
  recordAttempt: vi.fn(async () => {}),
}));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/events/outbox", () => ({ enqueueOutboxEvent: vi.fn(async () => {}) }));

const { activatePosDevice } = await import("@/server/pos/posDeviceActivation");
const { derivePosDeviceStatus, formatPairingCode, generatePairingCode, hashPairingCode, normalizePairingCode } =
  await import("@/server/pos/posDevice");
const { isIpRateLimited, recordAttempt } = await import("@/server/identity/loginGuard");
const { writeAuditLog } = await import("@/server/identity/audit");

const CODE = "ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789";

function pendingDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: "device-1",
    name: "Main Counter",
    code: "POS-01",
    storeId: "store-1",
    tenantId: "tenant-1",
    activatedAt: null,
    disabledAt: null,
    pairingExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isIpRateLimited).mockResolvedValue(false);
  mockDb.posDevice.findUnique.mockResolvedValue(pendingDevice());
  mockDb.posDevice.updateMany.mockResolvedValue({ count: 1 });
});

describe("pairing code primitives", () => {
  it("generates a distinct code every time, from the alphabet with no look-alike letters", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generatePairingCode()));
    expect(codes.size).toBe(50);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/);
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it("normalizes case and separators so a hand-typed code matches what was issued", () => {
    const raw = generatePairingCode();
    expect(normalizePairingCode(formatPairingCode(raw).toLowerCase())).toBe(raw);
    expect(hashPairingCode(formatPairingCode(raw).toLowerCase())).toBe(hashPairingCode(raw));
  });

  it("hashes to sha256 hex and never contains the plaintext", () => {
    const raw = generatePairingCode();
    const hash = hashPairingCode(raw);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(raw);
  });
});

describe("derivePosDeviceStatus", () => {
  it("a created-but-unclaimed device is PENDING_ACTIVATION, not ACTIVE", () => {
    expect(derivePosDeviceStatus(pendingDevice())).toBe("PENDING_ACTIVATION");
  });

  it("becomes ACTIVE only once a device has actually claimed it", () => {
    expect(derivePosDeviceStatus({ activatedAt: new Date(), disabledAt: null, pairingExpiresAt: null })).toBe("ACTIVE");
  });

  it("reports an unclaimed code past its TTL as PAIRING_EXPIRED", () => {
    expect(
      derivePosDeviceStatus({ activatedAt: null, disabledAt: null, pairingExpiresAt: new Date(Date.now() - 1000) }),
    ).toBe("PAIRING_EXPIRED");
  });

  it("DISABLED outranks everything — a revoked terminal is never reported active", () => {
    expect(derivePosDeviceStatus({ activatedAt: new Date(), disabledAt: new Date(), pairingExpiresAt: null })).toBe(
      "DISABLED",
    );
  });
});

describe("activatePosDevice", () => {
  it("issues a long-lived device secret distinct from the pairing code", async () => {
    const result = await activatePosDevice({ pairingCode: CODE, ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.deviceSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(result.deviceSecret).not.toBe(normalizePairingCode(CODE));
  });

  it("consumes the pairing code and records the first sighting in the same statement", async () => {
    await activatePosDevice({ pairingCode: CODE, ip: "10.0.0.1", correlationId: "c" });

    const call = mockDb.posDevice.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.pairingCodeHash).toBeNull();
    expect(call.data.pairingExpiresAt).toBeNull();
    expect(call.data.activatedAt).toBeInstanceOf(Date);
    expect(call.data.lastSeenAt).toBeInstanceOf(Date);
  });

  it("stores only the hash of the device secret, never the secret", async () => {
    const result = await activatePosDevice({ pairingCode: CODE, ip: "10.0.0.1", correlationId: "c" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const call = mockDb.posDevice.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.deviceSecretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(call.data.deviceSecretHash).not.toBe(result.deviceSecret);
    expect(JSON.stringify(call.data)).not.toContain(result.deviceSecret);
  });

  it("never writes the device secret or pairing code into the audit log", async () => {
    const result = await activatePosDevice({ pairingCode: CODE, ip: "10.0.0.1", correlationId: "c" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    for (const call of vi.mocked(writeAuditLog).mock.calls) {
      const serialized = JSON.stringify(call[0]);
      expect(serialized).not.toContain(result.deviceSecret);
      expect(serialized).not.toContain(normalizePairingCode(CODE));
    }
  });

  it("looks the device up by hash, never by the raw code", async () => {
    await activatePosDevice({ pairingCode: CODE, ip: "10.0.0.1", correlationId: "c" });
    expect(mockDb.posDevice.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pairingCodeHash: hashPairingCode(CODE) } }),
    );
  });

  it("rejects an unknown code and records the attempt so guessing is rate-limited", async () => {
    mockDb.posDevice.findUnique.mockResolvedValue(null);
    const result = await activatePosDevice({ pairingCode: CODE, ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("invalid");
    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ context: "pos_activate", success: false }),
    );
    expect(mockDb.posDevice.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an expired pairing code without issuing a secret", async () => {
    mockDb.posDevice.findUnique.mockResolvedValue(
      pendingDevice({ pairingExpiresAt: new Date(Date.now() - 1000) }),
    );
    const result = await activatePosDevice({ pairingCode: CODE, ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("expired");
    expect(mockDb.posDevice.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a disabled terminal — revocation survives possession of a valid code", async () => {
    mockDb.posDevice.findUnique.mockResolvedValue(pendingDevice({ disabledAt: new Date() }));
    const result = await activatePosDevice({ pairingCode: CODE, ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("disabled");
    expect(mockDb.posDevice.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to re-pair an already-activated terminal (replay)", async () => {
    mockDb.posDevice.findUnique.mockResolvedValue(pendingDevice({ activatedAt: new Date() }));
    const result = await activatePosDevice({ pairingCode: CODE, ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("already_activated");
    expect(mockDb.posDevice.updateMany).not.toHaveBeenCalled();
  });

  it("two devices racing the same code: only one is issued a secret", async () => {
    // Both pass the read; the claim arbitrates. The loser's updateMany matches zero rows
    // because the winner nulled pairingCodeHash in the same statement.
    mockDb.posDevice.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const [first, second] = await Promise.all([
      activatePosDevice({ pairingCode: CODE, ip: "10.0.0.1", correlationId: "c" }),
      activatePosDevice({ pairingCode: CODE, ip: "10.0.0.2", correlationId: "c" }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["already_activated", "ok"]);
    const secrets = [first, second].filter((r) => r.status === "ok");
    expect(secrets).toHaveLength(1);
  });

  it("the losing device is issued no secret at all", async () => {
    mockDb.posDevice.updateMany.mockResolvedValue({ count: 0 });
    const result = await activatePosDevice({ pairingCode: CODE, ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("already_activated");
    expect("deviceSecret" in result).toBe(false);
  });

  it("rate-limits before looking anything up", async () => {
    vi.mocked(isIpRateLimited).mockResolvedValue(true);
    const result = await activatePosDevice({ pairingCode: CODE, ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("rate_limited");
    expect(mockDb.posDevice.findUnique).not.toHaveBeenCalled();
  });

  it("propagates a datastore failure rather than reporting a paired terminal", async () => {
    mockDb.posDevice.findUnique.mockRejectedValue(new Error("connection refused"));
    await expect(
      activatePosDevice({ pairingCode: CODE, ip: "10.0.0.1", correlationId: "c" }),
    ).rejects.toThrow("connection refused");
  });
});
