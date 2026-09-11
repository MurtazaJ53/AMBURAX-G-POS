import type { NextRequest } from "next/server";

/** Duplicated identically across every auth route before this extraction (login, verify, resend). */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
