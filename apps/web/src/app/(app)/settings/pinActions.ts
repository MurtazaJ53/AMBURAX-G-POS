"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { setApprovalPin } from "@/server/identity/approvalPin";

export type PinActionState = { status: "idle" | "success" | "error"; message?: string; field?: string };

export async function saveApprovalPinAction(_prev: PinActionState, formData: FormData): Promise<PinActionState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };

  const pin = formData.get("pin")?.toString() ?? "";
  const confirm = formData.get("confirmPin")?.toString() ?? "";
  if (pin !== confirm) return { status: "error", message: "The two PINs don't match.", field: "confirmPin" };

  try {
    const res = await setApprovalPin({
      tenantId: resolved.context.tenantId,
      userId: resolved.context.userId,
      storeId: resolved.context.storeId,
      currentPassword: formData.get("currentPassword")?.toString() ?? "",
      pin,
    });
    switch (res.status) {
      case "forbidden":
        return { status: "error", message: "You don't work in this store, so you can't set a PIN here." };
      case "wrong_password":
        return { status: "error", message: "That password isn't right.", field: "currentPassword" };
      case "invalid_pin":
        return { status: "error", message: res.reason, field: "pin" };
    }
    revalidatePath("/settings");
    revalidatePath("/pos");
    revalidatePath("/till");
    return { status: "success", message: "PIN saved. Tap your name on the Till and type it to sell." };
  } catch (err) {
    logError("settings: save approval pin failed", err);
    return { status: "error", message: "Couldn't save your PIN. Try again." };
  }
}
