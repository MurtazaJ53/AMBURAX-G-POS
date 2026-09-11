import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { logError, sanitizeText } from "@/lib/safeLog";

/**
 * Phase 6 — what happens when PostgreSQL is unavailable.
 *
 * `src/test/safeLog.test.ts` proves the sanitizer against *synthetic* error objects that we
 * construct ourselves. That is necessary but not sufficient: it assumes we guessed the
 * shape of a real failure correctly.
 *
 * This suite makes a real Prisma client fail against a real dead port and feeds whatever
 * actually comes back through the real logger. It is the only version of this test that
 * can catch "Prisma changed its error shape and our patterns no longer match".
 */

// A synthetic credential aimed at a port nothing listens on. Never a real one.
const LEAK = "LEAKED_PASSWORD_DO_NOT_LOG";
const DEAD_URL = `postgresql://leakuser:${LEAK}@127.0.0.1:59999/nope`;

let logged: string[] = [];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logged = [];
  spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  });
});

afterEach(() => {
  spy.mockRestore();
});

/** Force a genuine connection failure and hand back whatever Prisma actually threw. */
async function realConnectionFailure(): Promise<unknown> {
  const client = new PrismaClient({ datasources: { db: { url: DEAD_URL } } });
  try {
    await client.$queryRaw`SELECT 1`;
    throw new Error("expected the connection to fail, but it succeeded");
  } catch (err) {
    return err;
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

describe("PostgreSQL unavailable — the application fails safely", () => {
  it("produces a real Prisma error rather than hanging or crashing the process", async () => {
    const err = await realConnectionFailure();

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toMatch(/Prisma/);
  });

  it("logs the real failure without leaking the password", async () => {
    const err = await realConnectionFailure();

    logError("auth/login: identity store unavailable", err, { correlationId: "corr-live" });

    const output = logged.join("\n");
    expect(output).not.toContain(LEAK);
    expect(output).not.toContain(DEAD_URL);
    expect(output).not.toContain("leakuser");
  });

  it("keeps enough context to diagnose the outage", async () => {
    const err = await realConnectionFailure();

    logError("auth/login: identity store unavailable", err, { correlationId: "corr-live" });

    const output = logged.join("\n");
    expect(output).toContain("auth/login");
    expect(output).toContain("corr-live");
    expect(output).toMatch(/Prisma\w*Error/);
    // One machine-readable line, not a raw object dump.
    expect(() => JSON.parse(logged[0]!)).not.toThrow();
  });

  it("does not leak even if the raw error text is passed through the sanitizer directly", async () => {
    const err = await realConnectionFailure();

    const raw = `${(err as Error).message}\n${(err as Error).stack ?? ""}`;
    const cleaned = sanitizeText(raw);

    expect(cleaned).not.toContain(LEAK);
    expect(cleaned).not.toContain("leakuser:");
  });

  it("survives logging the error object twice without throwing", async () => {
    const err = await realConnectionFailure();

    expect(() => {
      logError("stores: store setup failed", err, { correlationId: "c1" });
      logError("stores: store setup failed", err, { correlationId: "c2" });
    }).not.toThrow();
    expect(logged).toHaveLength(2);
  });
});
