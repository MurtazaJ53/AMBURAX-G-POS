"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { reviewReservation } from "@/server/inventory/reservations";

export type ReviewState = { status: "idle" | "success" | "error"; message?: string };

export async function reviewAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const decision = formData.get("decision") === "RELEASE" ? "RELEASE" : "RENEW";
  try {
    const res = await reviewReservation({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole },
      reservationId: formData.get("id")?.toString() ?? "",
      decision,
      reason: formData.get("reason")?.toString() ?? "",
    });
    if (res.status === "forbidden") return { status: "error", message: "Only a manager can renew or release a reservation." };
    if (res.status === "not_found") return { status: "error", message: "That reservation is no longer active." };
    if (res.status === "validation_error") return { status: "error", message: res.reason };
  } catch (err) {
    logError("reservations: review failed", err);
    return { status: "error", message: "That didn't save. Try again." };
  }
  revalidatePath("/inventory/reservations");
  return { status: "success", message: decision === "RENEW" ? "Kept for 7 more days." : "Released." };
}
