"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { createInvitation } from "@/server/tenant/invitation";
import { updateStaffRole, toggleStaffStatus } from "@/server/identity/staffPermissionsService";

export type PermissionsActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  inviteLink?: string;
};

async function getAuthorizedOwner() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (!session) redirect("/auth/login");
  if (session.user.tenantRole !== "OWNER") {
    throw new Error("Only tenant owners can manage permissions.");
  }
  return { session, token: token! };
}

export async function inviteStaffAction(
  _prev: PermissionsActionState,
  formData: FormData
): Promise<PermissionsActionState> {
  try {
    const { session, token } = await getAuthorizedOwner();
    const email = formData.get("email")?.toString()?.trim().toLowerCase() ?? "";
    const storeId = formData.get("storeId")?.toString() ?? "";
    const role = formData.get("role")?.toString() ?? "";

    if (!email || !storeId || !role) {
      return { status: "error", message: "Email, store, and role are required." };
    }

    const headerList = await headers();
    const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";

    const res = await createInvitation({
      sessionToken: token,
      storeId,
      email,
      role,
      ip,
      correlationId: `inv-${Date.now()}`,
    });

    if (res.status === "ok") {
      revalidatePath("/settings/security/permissions");
      return {
        status: "success",
        message: `Invitation successfully created for ${email}.`,
        inviteLink: res.devInviteLink,
      };
    }

    const errorMap: Record<string, string> = {
      unauthorized: "Your session has expired. Please log in again.",
      forbidden: "You do not have permission to invite team members.",
      rate_limited: "Too many invitation attempts. Please wait a few minutes.",
      invalid_role: "Selected role is invalid.",
      invalid_store: "Selected store is invalid or not in your organization.",
      email_unavailable: "This email address is already registered in AMBURAX.",
      already_member: "This user is already a member of the selected store.",
    };

    return {
      status: "error",
      message: errorMap[res.status] || `Failed to create invitation (${res.status}).`,
    };
  } catch (err: any) {
    return { status: "error", message: err.message || "An unexpected error occurred." };
  }
}

export async function updateStaffRoleAction(
  _prev: PermissionsActionState,
  formData: FormData
): Promise<PermissionsActionState> {
  try {
    const { session } = await getAuthorizedOwner();
    const targetUserId = formData.get("targetUserId")?.toString() ?? "";
    const storeId = formData.get("storeId")?.toString() ?? "";
    const newRole = formData.get("newRole")?.toString() ?? "";

    if (!targetUserId || !storeId || !newRole) {
      return { status: "error", message: "Missing required parameters." };
    }

    const res = await updateStaffRole({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      targetUserId,
      storeId,
      newRole,
    });

    if (res.status === "ok") {
      revalidatePath("/settings/security/permissions");
      return { status: "success", message: "Staff role updated successfully." };
    }

    return { status: "error", message: `Could not update role: ${res.status}` };
  } catch (err: any) {
    return { status: "error", message: err.message || "Failed to update staff role." };
  }
}

export async function toggleStaffStatusAction(
  _prev: PermissionsActionState,
  formData: FormData
): Promise<PermissionsActionState> {
  try {
    const { session } = await getAuthorizedOwner();
    const targetUserId = formData.get("targetUserId")?.toString() ?? "";
    const active = formData.get("active") === "true";

    const res = await toggleStaffStatus({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      targetUserId,
      active,
    });

    if (res.status === "ok") {
      revalidatePath("/settings/security/permissions");
      return {
        status: "success",
        message: active ? "Staff account activated." : "Staff account disabled.",
      };
    }

    return { status: "error", message: "Failed to update account status." };
  } catch (err: any) {
    return { status: "error", message: err.message || "Failed to toggle account status." };
  }
}

export async function updateModulePermissionsAction(
  _prev: PermissionsActionState,
  formData: FormData
): Promise<PermissionsActionState> {
  try {
    const { session } = await getAuthorizedOwner();
    const targetUserId = formData.get("targetUserId")?.toString() ?? "";
    const allowedModulesRaw = formData.get("allowedModules")?.toString() ?? "[]";
    const allowedModules = JSON.parse(allowedModulesRaw) as string[];

    if (!targetUserId) {
      return { status: "error", message: "Target user ID is required." };
    }

    const { updateStaffModulePermissions } = await import("@/server/identity/staffPermissionsService");
    const res = await updateStaffModulePermissions({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      targetUserId,
      allowedModules,
    });

    if (res.status === "ok") {
      revalidatePath("/settings/security/permissions");
      return {
        status: "success",
        message: `Custom module access privileges updated successfully (${allowedModules.length} modules granted).`,
      };
    }

    return { status: "error", message: "Failed to save module access permissions." };
  } catch (err: any) {
    return { status: "error", message: err.message || "Failed to update module access." };
  }
}
