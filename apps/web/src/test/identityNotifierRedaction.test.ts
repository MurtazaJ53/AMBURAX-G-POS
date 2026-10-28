import { afterEach, describe, expect, it, vi } from "vitest";
import { identityNotifier } from "@/server/identity/notifier";

const CODE = "482913";
const RESET = "https://example.test/reset?token=abc123";

function captureLogs() {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("identity notifier console fallback", () => {
  it("redacts OTP codes and reset links outside production unless LOG_OTP_FOR_DEV=1", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_OTP_FOR_DEV", "");
    vi.stubEnv("SMS_GATEWAY_PROVIDER", "");
    vi.stubEnv("EMAIL_API_KEY", "");
    const lines = captureLogs();
    await identityNotifier.sendOtp({ destination: "+919800000000", channel: "SMS", code: CODE });
    await identityNotifier.sendPasswordResetLink({ destination: "a@example.test", resetUrl: RESET });
    const out = lines.join("\n");
    expect(out).not.toContain(CODE);
    expect(out).not.toContain(RESET);
    expect(out).not.toContain("+919800000000");
    expect(out).toContain("[redacted]");
  });

  it("shows the values on a non-production server with the explicit opt-in", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_OTP_FOR_DEV", "1");
    vi.stubEnv("SMS_GATEWAY_PROVIDER", "");
    const lines = captureLogs();
    await identityNotifier.sendOtp({ destination: "+919800000000", channel: "SMS", code: CODE });
    expect(lines.join("\n")).toContain(CODE);
  });

  it("never shows the values in production, even with the opt-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_OTP_FOR_DEV", "1");
    vi.stubEnv("SMS_GATEWAY_PROVIDER", "");
    const lines = captureLogs();
    await identityNotifier.sendOtp({ destination: "+919800000000", channel: "SMS", code: CODE });
    expect(lines.join("\n")).not.toContain(CODE);
  });
});
