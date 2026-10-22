import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { searchCustomers, createCustomer } from "@/server/sales/customers";

export const runtime = "nodejs";

/** Customer search. Tenant-scoped from the session; a blank query returns nothing. */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const results = await searchCustomers({
      tenantId: resolved.context.tenantId,
      query: (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100),
    });

    return NextResponse.json({ status: "ok", results, correlationId }, { status: 200 });
  } catch (err) {
    logError("customers: search failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Customer lookup is temporarily unavailable.");
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer's name.").max(200),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[+0-9 ()-]*$/, "Enter a valid phone number.")
    .optional(),
  email: z.string().trim().nullish(),
  gstin: z.string().trim().nullish(),
  address: z
    .object({
      line1: z.string().trim().max(200).optional(),
      line2: z.string().trim().max(200).nullish(),
      city: z.string().trim().max(100).optional(),
      state: z.string().trim().max(100).nullish(),
      postalCode: z.string().trim().max(16).optional(),
      country: z.string().trim().max(2).nullish(),
    })
    .nullish(),
});

/**
 * Attach a walk-in customer.
 *
 * Repeating the same phone number returns the existing record rather than creating a
 * second one, so a double submission at a busy counter cannot fragment a customer's
 * history across duplicate rows. The response says which happened.
 */
export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError({
      code: "invalid_request",
      message: "Malformed request body.",
      status: 400,
      correlationId,
    });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Check the details and try again.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await createCustomer({
      tenantId: resolved.context.tenantId,
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      gstin: parsed.data.gstin ?? null,
      address: parsed.data.address ? {
        line1: parsed.data.address.line1 ?? "",
        line2: parsed.data.address.line2 ?? null,
        city: parsed.data.address.city ?? "",
        state: parsed.data.address.state ?? null,
        postalCode: parsed.data.address.postalCode ?? "",
        country: parsed.data.address.country ?? null,
      } : null,
    });

    if (result.status === "invalid_name") {
      return apiError({
        code: "validation_error",
        message: "Enter the customer's name.",
        status: 400,
        correlationId,
      });
    }

    if (result.status === "validation_error") {
      return NextResponse.json(
        {
          error: {
            code: "validation_error",
            message: result.error,
            field: result.field,
          },
          correlationId,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { status: "ok", customer: result.customer, existing: result.existing, correlationId },
      { status: result.existing ? 200 : 201 },
    );
  } catch (err) {
    logError("customers: create failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Adding a customer is temporarily unavailable.");
  }
}
