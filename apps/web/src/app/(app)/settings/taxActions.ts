"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { updateApparelSlab } from "@/server/tax/taxSettings";

export type SlabActionState = { status: "idle" | "success" | "error"; message?: string };

/** "2500" or "2,500.00" rupees to paise; null when it is not a positive amount. */
function rupeesToMinor(raw: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(raw.replaceAll(",", "").trim());
  if (!m) return null;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return minor > 0 ? minor : null;
}

/** "5" or "12.5" percent to basis points; null when it is not a valid rate. */
function percentToBp(raw: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bp > 0 && bp <= 10_000 ? bp : null;
}

export async function saveApparelSlabAction(_prev: SlabActionState, formData: FormData): Promise<SlabActionState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };

  const thresholdMinor = rupeesToMinor(formData.get("threshold")?.toString() ?? "");
  const lowRateBp = percentToBp(formData.get("lowRate")?.toString() ?? "");
  const highRateBp = percentToBp(formData.get("highRate")?.toString() ?? "");
  if (thresholdMinor === null) return { status: "error", message: "Enter the price limit in rupees, like 2500." };
  if (lowRateBp === null || highRateBp === null) {
    return { status: "error", message: "Enter each rate as a percentage, like 5 or 18." };
  }

  try {
    const res = await updateApparelSlab({
      tenantId: resolved.context.tenantId,
      actorUserId: resolved.context.userId,
      tenantRole: resolved.context.tenantRole,
      slab: { thresholdMinor, lowRateBp, highRateBp },
    });
    if (res.status === "forbidden") return { status: "error", message: "Only the business owner can change GST settings." };
    if (res.status === "validation_error") return { status: "error", message: res.reason };
    revalidatePath("/settings");
    revalidatePath("/pos");
    return { status: "success", message: "GST slab saved. New bills use it from now." };
  } catch (err) {
    logError("settings: save apparel slab failed", err);
    return { status: "error", message: "Couldn't save the GST settings. Try again." };
  }
}
