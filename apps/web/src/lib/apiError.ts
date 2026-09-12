import { NextResponse } from "next/server";

/**
 * The error envelope every v1 route already returns, extracted so the POS routes cannot
 * drift from it: `{ error: { code, message }, correlationId }`.
 *
 * `code` is what clients branch on and is stable; `message` is human-facing and may be
 * reworded. Messages here are written for the person at the counter, and deliberately
 * carry no internal detail — a stack trace, a Prisma message or a database hostname is
 * something to log, never something to return.
 */
export function apiError(params: {
  code: string;
  message: string;
  status: number;
  correlationId: string;
}): NextResponse {
  return NextResponse.json(
    { error: { code: params.code, message: params.message }, correlationId: params.correlationId },
    { status: params.status },
  );
}

export function unauthorized(correlationId: string): NextResponse {
  return apiError({
    code: "unauthorized",
    message: "Your session has expired. Please sign in again.",
    status: 401,
    correlationId,
  });
}

export function forbidden(correlationId: string, message: string): NextResponse {
  return apiError({ code: "forbidden", message, status: 403, correlationId });
}

export function noStore(correlationId: string): NextResponse {
  return apiError({
    code: "no_store",
    message: "No store is set up for this business yet.",
    status: 409,
    correlationId,
  });
}

/** Returned when a request fails for reasons the caller cannot fix — never a fake success. */
export function serviceUnavailable(correlationId: string, message: string): NextResponse {
  return apiError({ code: "service_unavailable", message, status: 503, correlationId });
}
