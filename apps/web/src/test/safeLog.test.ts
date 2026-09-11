import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * P0-2 regression suite.
 *
 * The audit found 25 call sites logging the raw error object. The specific fear was a
 * Prisma connection failure writing `DATABASE_URL` — password included — to stdout.
 *
 * Worth recording honestly: when probed, Prisma 5.22 already redacts the password in its
 * own messages. These tests therefore do NOT rely on Prisma's behaviour. They construct
 * errors that *do* carry the secret, because the guarantee has to hold for the `pg`
 * driver, `fetch`, and every future adapter too — none of which promise anything.
 */

// A fake credential, never a real one.
const SECRET = "SUPER_SECRET_PASSWORD";
const CONNECTION_STRING = `postgresql://testuser:${SECRET}@localhost:5432/testdb`;

// Set before importing the module: `safeLog` snapshots known secrets at load.
process.env.DATABASE_URL = CONNECTION_STRING;

const { logError, sanitizeError, sanitizeText } = await import("@/lib/safeLog");

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

const output = () => logged.join("\n");

/** Mirrors a PrismaClientInitializationError that echoes the connection string. */
function prismaStyleConnectionError(): Error {
  const err = new Error(
    `Can't reach database server. The provided database string is invalid: ${CONNECTION_STRING}. ` +
      `Please refer to the documentation.`,
  );
  err.name = "PrismaClientInitializationError";
  (err as { errorCode?: string }).errorCode = "P1001";
  (err as { clientVersion?: string }).clientVersion = "5.22.0";
  return err;
}

describe("P0-2 — a database error must not leak credentials", () => {
  it("does not write the password to the log", () => {
    logError("auth/login: identity store unavailable", prismaStyleConnectionError(), {
      correlationId: "corr-1",
    });

    expect(output()).not.toContain(SECRET);
  });

  it("does not write the connection string or its credentials to the log", () => {
    logError("auth/login: identity store unavailable", prismaStyleConnectionError(), {
      correlationId: "corr-1",
    });

    expect(output()).not.toContain(CONNECTION_STRING);
    expect(output()).not.toContain("postgresql://testuser");
    expect(output()).not.toContain("testuser:");
  });

  it("does not leak the password hidden inside a stack trace", () => {
    const err = prismaStyleConnectionError();
    err.stack = `PrismaClientInitializationError: connecting to ${CONNECTION_STRING}\n    at connect (db.ts:1:1)`;

    logError("stores: store setup failed", err, { correlationId: "corr-2" });

    expect(output()).not.toContain(SECRET);
  });

  it("keeps the debugging context that actually helps", () => {
    logError("auth/login: identity store unavailable", prismaStyleConnectionError(), {
      correlationId: "corr-1",
    });

    const text = output();
    expect(text).toContain("PrismaClientInitializationError");
    expect(text).toContain("P1001");
    expect(text).toContain("auth/login");
    expect(text).toContain("corr-1");
    expect(text).toContain("Can't reach database server");
  });

  it("redacts the live DATABASE_URL entirely, host included", () => {
    // The exact-known-secret pass fires before any pattern, so for the real connection
    // string the redaction is total — we lose the host, and that is the right trade: this
    // is the one value we know with certainty is a secret.
    logError("auth/login: identity store unavailable", prismaStyleConnectionError(), {
      correlationId: "corr-1",
    });

    expect(output()).not.toContain("localhost:5432/testdb");
    expect(output()).toContain("[redacted]");
  });

  it("keeps the host for a connection string that is NOT the known secret", () => {
    // A different database (a future read replica, a queue, a cache): credentials are
    // stripped but host/port/name survive, because those are what make a log useful.
    const err = new Error("failed connecting to postgresql://other:pw@db-replica:5432/analytics");

    logError("reports: query failed", err, { correlationId: "corr-3" });

    const text = output();
    expect(text).not.toContain("other:pw");
    expect(text).toContain("db-replica:5432/analytics");
  });

  it("emits one structured JSON line, not a raw object dump", () => {
    logError("tenants: registration failed", prismaStyleConnectionError(), { correlationId: "c" });

    expect(logged).toHaveLength(1);
    const parsed = JSON.parse(logged[0]!) as Record<string, unknown>;
    expect(parsed.level).toBe("error");
    expect(parsed.scope).toBe("tenants: registration failed");
    expect(parsed.correlationId).toBe("c");
  });

  it("drops non-allow-listed error properties wholesale", () => {
    const err = prismaStyleConnectionError();
    // Libraries attach arbitrary payloads; some have carried credentials.
    (err as { meta?: unknown }).meta = {
      connectionString: CONNECTION_STRING,
      apiKey: "sk_live_abcdef123456",
    };

    logError("invitations: create failed", err, { correlationId: "c" });

    const text = output();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("sk_live_abcdef123456");
    expect(text).not.toContain("clientVersion");
  });
});

describe("sanitizeText — other secret shapes", () => {
  it("strips credentials from any URL scheme but keeps the host", () => {
    expect(sanitizeText("connecting to redis://admin:hunter2@cache:6379")).not.toContain("hunter2");
    expect(sanitizeText("connecting to redis://admin:hunter2@cache:6379")).toContain("cache:6379");
  });

  it("redacts authorization headers, bearer tokens and cookies", () => {
    expect(sanitizeText("authorization: Bearer abcdefghijklmnop")).not.toContain("abcdefghijklmnop");
    expect(sanitizeText("Cookie: amburax_session=deadbeefdeadbeef")).not.toContain("deadbeefdeadbeef");
  });

  it("redacts secret-named key/value pairs", () => {
    expect(sanitizeText('{"password":"hunter2"}')).not.toContain("hunter2");
    expect(sanitizeText("api_key=AKIAIOSFODNN7EXAMPLE")).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(sanitizeText("otp=483920")).not.toContain("483920");
  });

  it("redacts our own opaque tokens (64-char sha256 hex)", () => {
    const token = "a".repeat(64);
    expect(sanitizeText(`token ${token} rejected`)).not.toContain(token);
  });

  it("redacts private key blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    expect(sanitizeText(pem)).not.toContain("MIIEowIBAAKCAQEA");
  });

  it("leaves ordinary diagnostic text intact", () => {
    const msg = "Unique constraint failed on the fields: (`code`)";
    expect(sanitizeText(msg)).toBe(msg);
  });
});

describe("sanitizeError — robustness", () => {
  it("handles a non-Error throw without crashing", () => {
    expect(sanitizeError("plain string failure").message).toBe("plain string failure");
    expect(sanitizeError(undefined).name).toBe("undefined");
  });

  it("survives an error whose getter throws", () => {
    const hostile = new Error("boom");
    Object.defineProperty(hostile, "message", {
      get() {
        throw new Error("getter exploded");
      },
    });

    expect(() => sanitizeError(hostile)).not.toThrow();
    expect(sanitizeError(hostile).name).toBe("UnserializableError");
  });

  it("scrubs context values too — a call site may pass more than it realises", () => {
    logError("scope", new Error("ok"), { correlationId: `leaked ${CONNECTION_STRING}` });
    expect(output()).not.toContain(SECRET);
  });
});
