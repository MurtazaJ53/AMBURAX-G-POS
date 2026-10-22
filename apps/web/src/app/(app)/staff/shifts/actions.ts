"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { cancelShift, createShift, publishShifts } from "@/server/staff/shiftPlans";

export type PlanState = { status: "idle" | "error" | "success"; message?: string; nonce?: number };

const at = (date: string, time: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? new Date(`${date}T${time}:00+05:30`) : new Date(NaN);

export async function planAction(_prev: PlanState, formData: FormData): Promise<PlanState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const actor = { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole };
  const intent = formData.get("intent")?.toString();
  try {
    let res: { status: string; reason?: string; published?: number };
    if (intent === "publish") {
      res = await publishShifts({ actor, storeId: c.storeId });
    } else if (intent === "cancel") {
      res = await cancelShift({ actor, shiftId: formData.get("shiftId")?.toString() ?? "" });
    } else {
      const date = formData.get("date")?.toString() ?? "";
      const start = at(date, formData.get("start")?.toString() ?? "");
      let end = at(date, formData.get("end")?.toString() ?? "");
      // A shift that ends before it starts runs past midnight.
      if (end <= start) end = new Date(end.getTime() + 86_400_000);
      res = await createShift({
        actor,
        storeId: c.storeId,
        userId: formData.get("userId")?.toString() ?? "",
        startAt: start,
        endAt: end,
        breakMinutes: Number(formData.get("breakMinutes") ?? 0),
        notes: formData.get("notes")?.toString() ?? null,
      });
    }
    if (res.status === "forbidden") return { status: "error", message: "Only the owner or a store manager plans shifts." };
    if (res.status === "not_found") return { status: "error", message: "That shift no longer exists." };
    if (res.status === "validation_error") return { status: "error", message: res.reason };
  } catch (err) {
    logError("shifts: plan action failed", err);
    return { status: "error", message: "That didn't save. Try again." };
  }
  revalidatePath("/staff/shifts");
  revalidatePath("/staff/attendance");
  return {
    status: "success",
    nonce: Date.now(),
    message: intent === "publish" ? "Shifts published." : intent === "cancel" ? "Shift cancelled." : "Shift added as a draft. Publish to share it.",
  };
}

export async function closeAndCountAction(
  sessionId: string,
  counted: { cash: number; upi: number; card: number },
  note?: string
) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const actor = { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole };

  const { closeAndCount } = await import("@/server/pos/cashRegister");

  const res = await closeAndCount({
    actor,
    sessionId,
    counted: {
      CASH: Math.round(counted.cash * 100),
      UPI: Math.round(counted.upi * 100),
      CARD: Math.round(counted.card * 100),
    },
    note: note ?? null,
  });

  if (res.status === "ok") {
    revalidatePath("/staff/shifts");
    return { status: "ok" };
  }
  return { status: "error", message: "reason" in res ? res.reason : "Could not close shift." };
}

export async function approveVarianceAction(sessionId: string, note: string) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const actor = { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole };

  const { approveVariance } = await import("@/server/pos/cashRegister");

  const res = await approveVariance({
    actor,
    sessionId,
    note,
  });

  if (res.status === "ok") {
    revalidatePath("/staff/shifts");
    return { status: "ok" };
  }
  return { status: "error", message: "reason" in res ? res.reason : "Could not approve variance." };
}

export async function cashMovementAction(input: {
  sessionId: string;
  kind: "PAY_IN" | "PAY_OUT";
  amountRupees: number;
  reason: string;
  category?: string;
  payee?: string;
}) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const actor = { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole };

  const { recordCashMovement } = await import("@/server/pos/cashRegister");

  const res = await recordCashMovement({
    actor,
    sessionId: input.sessionId,
    kind: input.kind,
    amountMinor: Math.round(input.amountRupees * 100),
    reason: input.reason,
    category: input.category,
    payee: input.payee,
    idempotencyKey: crypto.randomUUID(),
  });

  if (res.status === "ok") {
    revalidatePath("/staff/shifts");
    return { status: "ok" };
  }
  return { status: "error", message: "reason" in res ? res.reason : "Could not record cash movement." };
}
