import { describe, expect, it, vi } from "vitest";
import { BLOCKED_CONFIG, resolveCreditMode, validateCreditMode } from "@/server/khata/creditMode";
import { writeAuditLogTx } from "@/server/identity/audit";

vi.mock("@/server/db", () => ({ db: { auditLog: { create: vi.fn() } } }));

describe("validateCreditMode", () => {
  it.each([
    ["BLOCKED", null],
    ["BLOCKED", undefined],
    ["UNLIMITED", null],
    ["LIMITED", 1],
    ["LIMITED", 5_000_000],
  ])("accepts %s with limit %s", (mode, limit) => {
    const res = validateCreditMode(mode, limit);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config).toEqual({ mode, limitMinor: mode === "LIMITED" ? limit : null });
  });

  it.each([
    ["LIMITED", null, "positive"],
    ["LIMITED", undefined, "positive"],
    ["LIMITED", 0, "positive"],
    ["LIMITED", -100, "positive"],
    ["LIMITED", 10.5, "positive"],
    ["LIMITED", 2_147_483_648, "no greater than"],
    ["LIMITED", Number.MAX_SAFE_INTEGER + 1, "positive"],
    ["LIMITED", "1000", "positive"],
    ["UNLIMITED", 1000, "cannot carry a limit"],
    ["BLOCKED", 1000, "cannot carry a limit"],
    ["UNLIMITED", 0, "cannot carry a limit"],
    ["unlimited", null, "must be"],
    ["", null, "must be"],
    [null, null, "must be"],
    [undefined, undefined, "must be"],
  ])("rejects %s with limit %s", (mode, limit, message) => {
    const res = validateCreditMode(mode, limit);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain(message);
  });
});

describe("resolveCreditMode fails closed", () => {
  it.each([
    ["no configuration", undefined],
    ["null configuration", null],
    ["an empty object", {}],
    ["a null mode", { mode: null, limitMinor: null }],
    ["an unknown mode", { mode: "OPEN", limitMinor: null }],
    ["LIMITED without a limit", { mode: "LIMITED", limitMinor: null }],
    ["LIMITED with a zero limit", { mode: "LIMITED", limitMinor: 0 }],
    ["UNLIMITED carrying a limit", { mode: "UNLIMITED", limitMinor: 500 }],
  ])("treats %s as BLOCKED", (_label, stored) => {
    expect(resolveCreditMode(stored as never)).toEqual(BLOCKED_CONFIG);
  });

  it("never reads a null limit as unlimited", () => {
    expect(resolveCreditMode({ limitMinor: null }).mode).toBe("BLOCKED");
  });

  it("keeps valid configuration as stored", () => {
    expect(resolveCreditMode({ mode: "UNLIMITED", limitMinor: null })).toEqual({ mode: "UNLIMITED", limitMinor: null });
    expect(resolveCreditMode({ mode: "LIMITED", limitMinor: 250_000 })).toEqual({ mode: "LIMITED", limitMinor: 250_000 });
  });
});

describe("writeAuditLogTx", () => {
  it("writes through the given transaction, not the shared client", async () => {
    const { db } = await import("@/server/db");
    const tx = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
    await writeAuditLogTx(tx as never, {
      tenantId: "t1",
      userId: "u1",
      action: "credit.mode.test",
      correlationId: "c1",
      metadata: { mode: "BLOCKED" },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", userId: "u1", action: "credit.mode.test", correlationId: "c1", metadata: { mode: "BLOCKED" } },
    });
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});
