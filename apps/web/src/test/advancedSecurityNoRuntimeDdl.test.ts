import { describe, expect, it, vi } from "vitest";

const executeRawUnsafe = vi.fn(async (..._args: unknown[]) => 1);
const queryRawUnsafe = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
vi.mock("@/server/db", () => ({ db: { $executeRawUnsafe: executeRawUnsafe, $queryRawUnsafe: queryRawUnsafe } }));

const { updateSecurityPreferences } = await import("@/server/identity/advancedSecurity");

describe("advanced security (bug 25)", () => {
  it("never creates or alters schema at runtime; the Prisma migration owns the tables", async () => {
    await updateSecurityPreferences({
      userId: "u1",
      tenantId: "t1",
      signInAlertsEnabled: true,
      alertOnNewDeviceOnly: true,
      notifyEmail: true,
      notifySms: false,
    });
    const sql = [...executeRawUnsafe.mock.calls, ...queryRawUnsafe.mock.calls].map((c) => String(c[0]));
    expect(sql.some((s) => /\b(CREATE|ALTER)\s+(TABLE|TYPE)\b|information_schema/i.test(s))).toBe(false);
    expect(sql.some((s) => s.includes('INSERT INTO "user_security_preferences"'))).toBe(true);
  });
});
