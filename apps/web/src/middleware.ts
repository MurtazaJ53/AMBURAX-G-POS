import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Only protect state-mutating requests to our internal APIs
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    ["POST", "PATCH", "PUT", "DELETE"].includes(request.method)
  ) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host"); // e.g. localhost:3000
    let appBaseHost: string | null = null;
    try {
      if (process.env.APP_BASE_URL) {
        appBaseHost = new URL(process.env.APP_BASE_URL).host;
      }
    } catch {
      // Ignore malformed APP_BASE_URL
    }

    const allowedHosts = [host, appBaseHost].filter(Boolean);

    if (origin) {
      try {
        const originUrl = new URL(origin);

        if (!allowedHosts.includes(originUrl.host)) {
          console.warn(`[SECURITY] Rejected cross-origin API request. Origin: ${origin}, Allowed: ${allowedHosts.join(", ")}`);
          return NextResponse.json(
            { error: { code: "forbidden", message: "Cross-origin requests are not allowed." } },
            { status: 403 }
          );
        }
      } catch (e) {
        return NextResponse.json(
          { error: { code: "forbidden", message: "Invalid Origin header." } },
          { status: 403 }
        );
      }
    } else {
      // If Origin is missing, fall back to Referer check for defense-in-depth.
      const referer = request.headers.get("referer");
      if (referer) {
        try {
          const refererUrl = new URL(referer);

          if (!allowedHosts.includes(refererUrl.host)) {
            console.warn(`[SECURITY] Rejected cross-origin API request via Referer. Referer: ${referer}, Allowed: ${allowedHosts.join(", ")}`);
            return NextResponse.json(
              { error: { code: "forbidden", message: "Cross-origin requests are not allowed." } },
              { status: 403 }
            );
          }
        } catch (e) {
          // Ignore malformed referer if origin is missing.
        }
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};

