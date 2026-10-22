"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { decideCorrection, punch, requestCorrection } from "@/server/staff/attendance";

export type PunchState = { status: "idle" | "error" | "success"; message?: string };

export async function punchAction(_prev: PunchState, formData: FormData): Promise<PunchState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const logType = formData.get("logType") === "OUT" ? "OUT" : "IN";
  try {
    const res = await punch({ actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole }, storeId: c.storeId, logType });
    if (res.status === "forbidden") return { status: "error", message: "You aren't part of this store's team." };
    if (res.status === "conflict") return { status: "error", message: res.reason };
  } catch (err) {
    logError("attendance: punch failed", err);
    return { status: "error", message: "That didn't save. Try again." };
  }
  revalidatePath("/staff/attendance");
  return { status: "success", message: logType === "IN" ? "Clocked in." : "Clocked out." };
}

export type CorrectionState = { status: "idle" | "error" | "success"; message?: string };

function fail(res: { status: string; reason?: string }): CorrectionState {
  if (res.status === "forbidden") return { status: "error", message: "Only the owner or a store manager can do that." };
  if (res.status === "not_found") return { status: "error", message: "That punch or request no longer exists." };
  return { status: "error", message: res.reason ?? "That didn't save." };
}

/** E5: ask for a correction (your own, or someone else's if you manage the store). */
export async function requestCorrectionAction(_prev: CorrectionState, formData: FormData): Promise<CorrectionState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const date = formData.get("date")?.toString() ?? "";
  const time = formData.get("time")?.toString() ?? "";
  const at = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? new Date(`${date}T${time}:00+05:30`) : new Date(NaN);
  try {
    const res = await requestCorrection({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole },
      storeId: c.storeId,
      userId: formData.get("userId")?.toString() || c.userId,
      logType: formData.get("logType") === "OUT" ? "OUT" : "IN",
      correctedAt: at,
      originalCheckinId: formData.get("originalCheckinId")?.toString() || null,
      reason: formData.get("reason")?.toString() ?? "",
    });
    if (res.status !== "ok") return fail(res);
  } catch (err) {
    logError("attendance: correction request failed", err);
    return { status: "error", message: "That didn't save. Try again." };
  }
  revalidatePath("/staff/attendance");
  return { status: "success", message: "Correction requested. A manager will review it." };
}

export async function decideCorrectionAction(_prev: CorrectionState, formData: FormData): Promise<CorrectionState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const approve = formData.get("decision") === "APPROVE";
  try {
    const res = await decideCorrection({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole },
      correctionId: formData.get("id")?.toString() ?? "",
      approve,
      note: formData.get("note")?.toString() ?? "",
    });
    if (res.status !== "ok") return fail(res);
  } catch (err) {
    logError("attendance: correction decision failed", err);
    return { status: "error", message: "That didn't save. Try again." };
  }
  revalidatePath("/staff/attendance");
  return { status: "success", message: approve ? "Approved." : "Rejected." };
}

