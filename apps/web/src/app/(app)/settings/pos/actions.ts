"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { savePosConfig } from "@/server/pos/posConfig";

export type PosConfigState = { status: "idle" | "error" | "success"; message?: string };

export async function savePosConfigAction(_prev: PosConfigState, formData: FormData): Promise<PosConfigState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const n = (k: string) => Number(formData.get(k)?.toString().trim() ?? "");
  try {
    const res = await savePosConfig({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole },
      storeId: c.storeId,
      config: { heldBillHours: n("heldBillHours"), lateGraceMinutes: n("lateGraceMinutes"), halfDayPercent: n("halfDayPercent") },
    });
    if (res.status === "forbidden") return { status: "error", message: "Only the owner changes these." };
    if (res.status === "not_found") return { status: "error", message: "This store no longer exists." };
    if (res.status === "validation_error") return { status: "error", message: res.reason };
  } catch (err) {
    logError("settings: POS config failed", err);
    return { status: "error", message: "That didn't save. Try again." };
  }
  revalidatePath("/settings/pos");
  return { status: "success", message: "Saved. New held bills and attendance use these now." };
}
