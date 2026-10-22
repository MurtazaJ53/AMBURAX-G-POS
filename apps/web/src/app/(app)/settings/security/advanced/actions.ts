"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import {
  updateStoreSecurityPolicy,
  revokeDevicePairing,
} from "@/server/identity/advancedSecurityService";

export type AdvancedActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

async function getAuthorizedOwner() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (!session) redirect("/auth/login");
  if (session.user.tenantRole !== "OWNER") {
    throw new Error("Only owners can modify advanced security parameters.");
  }
  return session;
}

export async function updateStorePolicyAction(
  _prev: AdvancedActionState,
  formData: FormData
): Promise<AdvancedActionState> {
  try {
    const session = await getAuthorizedOwner();
    const storeId = formData.get("storeId")?.toString() ?? "";
    const heldBillHours = parseInt(formData.get("heldBillHours")?.toString() || "24", 10);
    const lateGraceMinutes = parseInt(formData.get("lateGraceMinutes")?.toString() || "10", 10);

    if (!storeId) {
      return { status: "error", message: "Store is required." };
    }

    await updateStoreSecurityPolicy({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      storeId,
      heldBillHours,
      lateGraceMinutes,
    });

    revalidatePath("/settings/security/advanced");
    return { status: "success", message: "Store security parameters updated successfully." };
  } catch (err: any) {
    return { status: "error", message: err.message || "Failed to update store policy." };
  }
}

export async function revokeDeviceAction(
  _prev: AdvancedActionState,
  formData: FormData
): Promise<AdvancedActionState> {
  try {
    const session = await getAuthorizedOwner();
    const deviceId = formData.get("deviceId")?.toString() ?? "";

    if (!deviceId) {
      return { status: "error", message: "Device ID is required." };
    }

    await revokeDevicePairing({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      deviceId,
    });

    revalidatePath("/settings/security/advanced");
    return { status: "success", message: "Device pairing revoked. Terminal locked." };
  } catch (err: any) {
    return { status: "error", message: err.message || "Failed to revoke device pairing." };
  }
}
