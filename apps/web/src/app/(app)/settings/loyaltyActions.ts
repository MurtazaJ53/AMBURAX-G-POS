"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { saveProgram } from "@/server/loyalty/loyalty";

export type LoyaltyState = { status: "idle" | "success" | "error"; message?: string };

const num = (f: FormData, k: string) => Number(f.get(k)?.toString().trim() ?? "");

export async function saveLoyaltyAction(_prev: LoyaltyState, formData: FormData): Promise<LoyaltyState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  try {
    const res = await saveProgram({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole },
      rules: {
        pointsPerUnit: num(formData, "pointsPerUnit"),
        // The form takes rupees and percent; the program stores paise and basis points.
        earnUnitMinor: Math.round(num(formData, "earnUnitRupees") * 100),
        pointValueMinor: Math.round(num(formData, "pointValueRupees") * 100),
        expiryMonths: num(formData, "expiryMonths"),
        minRedeemPoints: num(formData, "minRedeemPoints"),
        maxRedeemBp: Math.round(num(formData, "maxRedeemPercent") * 100),
      },
    });
    if (res.status === "forbidden") return { status: "error", message: "Only the owner sets loyalty rules." };
    if (res.status === "validation_error") return { status: "error", message: res.reason };
  } catch (err) {
    logError("settings: loyalty save failed", err);
    return { status: "error", message: "That didn't save. Try again." };
  }
  revalidatePath("/settings");
  return { status: "success", message: "Rules saved. Loyalty stays off until finance and the GST reviewer sign off." };
}
