"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { cancelLeave, decideLeave, requestLeave, type LeaveResult } from "@/server/staff/leave";

export type LeaveState = { status: "idle" | "error" | "success"; message?: string; nonce?: number };

function fail(res: Exclude<LeaveResult, { status: "ok" }>): LeaveState {
  if (res.status === "forbidden") return { status: "error", message: "Only the owner or a store manager can do that." };
  if (res.status === "not_found") return { status: "error", message: "That request no longer exists." };
  return { status: "error", message: res.reason };
}

export async function leaveAction(_prev: LeaveState, formData: FormData): Promise<LeaveState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const actor = { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole };
  const intent = formData.get("intent")?.toString();
  let res: LeaveResult;
  try {
    if (intent === "decide") {
      res = await decideLeave({
        actor,
        leaveId: formData.get("id")?.toString() ?? "",
        approve: formData.get("decision") === "APPROVE",
        note: formData.get("note")?.toString() ?? "",
      });
    } else if (intent === "cancel") {
      res = await cancelLeave({ actor, leaveId: formData.get("id")?.toString() ?? "" });
    } else {
      const from = formData.get("fromDate")?.toString() ?? "";
      res = await requestLeave({
        actor,
        storeId: c.storeId,
        userId: formData.get("userId")?.toString() || c.userId,
        kind: formData.get("kind") === "UNAVAILABLE" ? "UNAVAILABLE" : "LEAVE",
        fromDate: from,
        toDate: formData.get("toDate")?.toString() || from,
        halfDay: formData.get("halfDay") === "on",
        reason: formData.get("reason")?.toString() ?? "",
      });
    }
  } catch (err) {
    logError("leave: action failed", err);
    return { status: "error", message: "That didn't save. Try again." };
  }
  if (res.status !== "ok") return fail(res);
  revalidatePath("/staff/leave");
  revalidatePath("/staff/shifts");
  const decision = formData.get("decision") === "APPROVE" ? "Approved." : "Rejected.";
  return {
    status: "success",
    nonce: Date.now(),
    message: intent === "decide" ? decision : intent === "cancel" ? "Request withdrawn." : "Request sent. A manager will review it.",
  };
}
