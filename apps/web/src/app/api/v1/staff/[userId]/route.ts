import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";

export const runtime = "nodejs";

const updateRoleSchema = z.object({
  role: z.enum(["STORE_MANAGER", "CASHIER", "STAFF"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const resolvedParams = await params;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return forbidden(correlationId, "Store context required.");

    // Only owner can change store member roles
    if (resolved.context.tenantRole !== "OWNER") {
      return forbidden(correlationId, "Only the business owner can change staff roles.");
    }

    const body = await req.json().catch(() => null);
    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) {
      return apiError({
        code: "invalid_input",
        message: "Invalid role selected.",
        status: 400,
        correlationId,
      });
    }

    const targetMembership = await db.storeMembership.findUnique({
      where: {
        userId_storeId: {
          userId: resolvedParams.userId,
          storeId: resolved.context.storeId,
        },
      },
      include: { user: true },
    });

    if (!targetMembership) {
      return apiError({
        code: "not_found",
        message: "Staff member not found in this store.",
        status: 404,
        correlationId,
      });
    }

    // Owner cannot change their own store role away from owner hierarchy
    if (targetMembership.user.tenantRole === "OWNER") {
      return apiError({
        code: "cannot_modify_owner",
        message: "The business owner's role cannot be modified.",
        status: 400,
        correlationId,
      });
    }

    const previousRole = targetMembership.role;
    const updated = await db.storeMembership.update({
      where: {
        userId_storeId: {
          userId: resolvedParams.userId,
          storeId: resolved.context.storeId,
        },
      },
      data: {
        role: parsed.data.role,
      },
    });

    await writeAuditLog({
      tenantId: resolved.context.tenantId,
      userId: resolved.context.userId,
      action: "staff.role_updated",
      correlationId,
      metadata: {
        targetUserId: resolvedParams.userId,
        storeId: resolved.context.storeId,
        previousRole,
        newRole: parsed.data.role,
      },
    });

    return NextResponse.json({ status: "ok", membership: updated, correlationId });
  } catch (err) {
    logError("staff:update-role: failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Failed to update staff role.");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const resolvedParams = await params;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return forbidden(correlationId, "Store context required.");

    if (resolved.context.tenantRole !== "OWNER") {
      return forbidden(correlationId, "Only the business owner can remove staff members.");
    }

    const targetMembership = await db.storeMembership.findUnique({
      where: {
        userId_storeId: {
          userId: resolvedParams.userId,
          storeId: resolved.context.storeId,
        },
      },
      include: { user: true },
    });

    if (!targetMembership) {
      return apiError({
        code: "not_found",
        message: "Staff member not found in this store.",
        status: 404,
        correlationId,
      });
    }

    if (targetMembership.user.tenantRole === "OWNER") {
      return apiError({
        code: "cannot_remove_owner",
        message: "The business owner cannot be removed from a store.",
        status: 400,
        correlationId,
      });
    }

    await db.storeMembership.delete({
      where: {
        userId_storeId: {
          userId: resolvedParams.userId,
          storeId: resolved.context.storeId,
        },
      },
    });

    await writeAuditLog({
      tenantId: resolved.context.tenantId,
      userId: resolved.context.userId,
      action: "staff.removed",
      correlationId,
      metadata: {
        targetUserId: resolvedParams.userId,
        storeId: resolved.context.storeId,
        removedRole: targetMembership.role,
      },
    });

    return NextResponse.json({ status: "ok", correlationId });
  } catch (err) {
    logError("staff:remove: failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Failed to remove staff member.");
  }
}
