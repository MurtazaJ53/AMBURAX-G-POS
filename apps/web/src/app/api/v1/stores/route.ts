import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createFirstStore } from "@/server/tenant/storeSetup";
import { clientIp } from "@/lib/request";
import { env } from "@/lib/env";

export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(200),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{2,10}$/, "Use 2-10 letters/numbers, no spaces."),
  storeType: z.enum(["RETAIL", "WAREHOUSE"]),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code, e.g. INR."),
  phone: z.string().trim().max(20).optional(),
  addressLine: z.string().trim().min(3).max(300),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().max(20).optional(),
});

// Tenant identity is never accepted from the client — it's resolved from the session
// cookie inside createFirstStore(). There is deliberately no tenantId/ownerId field here.
export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in required." }, correlationId },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Malformed request body." }, correlationId },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: { code: "validation_error", message: first?.message ?? "Check the form and try again." }, correlationId },
      { status: 400 },
    );
  }

  try {
    const result = await createFirstStore({
      sessionToken,
      name: parsed.data.name,
      code: parsed.data.code,
      storeType: parsed.data.storeType,
      currency: parsed.data.currency,
      phone: parsed.data.phone,
      addressLine: parsed.data.addressLine,
      city: parsed.data.city,
      state: parsed.data.state,
      postalCode: parsed.data.postalCode,
      ip: clientIp(req),
      correlationId,
    });

    switch (result.status) {
      case "unauthorized":
        return NextResponse.json(
          { error: { code: "unauthorized", message: "Your session has expired. Please sign in again." }, correlationId },
          { status: 401 },
        );

      case "forbidden":
        return NextResponse.json(
          {
            error: {
              code: "forbidden",
              message: "Only the business owner can set up the store.",
            },
            correlationId,
          },
          { status: 403 },
        );

      case "rate_limited":
        return NextResponse.json(
          { error: { code: "rate_limited", message: "Too many attempts. Try again later." }, correlationId },
          { status: 429 },
        );

      case "already_completed":
        return NextResponse.json(
          {
            error: {
              code: "already_completed",
              message: "Store setup for this business is already complete.",
            },
            correlationId,
          },
          { status: 409 },
        );

      case "store_conflict":
        return NextResponse.json(
          { error: { code: "store_conflict", message: "That store code is already in use." }, correlationId },
          { status: 409 },
        );

      case "ok":
        return NextResponse.json({ status: "ok", store: result.store, correlationId }, { status: 201 });
    }
  } catch (err) {
    console.error("[stores] store setup failed", { correlationId, err });
    return NextResponse.json(
      {
        error: {
          code: "service_unavailable",
          message: "Store setup is temporarily unavailable. Please try again shortly.",
        },
        correlationId,
      },
      { status: 503 },
    );
  }
}
