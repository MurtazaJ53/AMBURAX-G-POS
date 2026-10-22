import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden } from "@/lib/apiError";
import { resolveSession } from "@/server/identity/session";
import { deleteUserAccount } from "@/server/identity/accountDeletion";

export const runtime = "nodejs";

/**
 * DELETE /api/v1/auth/account
 * GDPR / DPDP Article Right to Erasure / Account Deletion.
 * Allows authenticated users to request erasure of their personal account data.
 */
export async function DELETE(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return unauthorized(correlationId);
  }

  try {
    const session = await resolveSession(sessionToken);
    if (!session) {
      return unauthorized(correlationId);
    }

    const result = await deleteUserAccount({
      tenantId: session.tenantId,
      userId: session.userId,
      correlationId,
    });

    if (result.status === "owner_cannot_delete") {
      return forbidden(correlationId, result.message ?? "Cannot delete owner account with active staff.");
    }

    if (result.status === "not_found") {
      return apiError({ code: "not_found", message: "Account not found.", status: 404, correlationId });
    }

    const res = NextResponse.json({
      status: "ok",
      message: "Your account and personal data have been anonymized and deleted.",
      correlationId,
    });

    // Clear session cookie on deletion
    res.cookies.set(env.SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return res;
  } catch (err) {
    logError("auth/account: deletion failed", err, { correlationId });
    return apiError({
      code: "server_error",
      message: "Account deletion encountered an error. Please try again shortly.",
      status: 500,
      correlationId,
    });
  }
}
