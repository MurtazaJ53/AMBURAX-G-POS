"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { approveVariance, closeAndCount, recordCashMovement, setOpeningFloat, type RegisterResult } from "@/server/pos/cashRegister";

export type CashActionState = {
  status: "idle" | "error" | "success" | "approval";
  message?: string;
  nonce?: number;
  /** Pay-outs over the limit (E6): who must approve. */
  level?: "MANAGER" | "OWNER";
};

/** Rupees as typed ("1,250.50") to paise; NaN when it is not a money amount. */
function toMinor(raw: FormDataEntryValue | null): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec((raw?.toString() ?? "").replaceAll(",", "").trim());
  if (!m) return Number.NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

async function actor() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return null;
  const c = resolved.context;
  return { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole };
}

function toState(res: RegisterResult, success: string): CashActionState {
  switch (res.status) {
    case "ok":
      return { status: "success", message: success, nonce: Date.now() };
    case "forbidden":
      return { status: "error", message: "Only the cashier on this shift, a store manager or the owner can do this." };
    case "not_found":
      return { status: "error", message: "This shift could not be found." };
    default:
      return { status: "error", message: res.reason };
  }
}

async function run(sessionId: string, success: string, fn: () => Promise<RegisterResult>): Promise<CashActionState> {
  try {
    const res = await fn();
    if (res.status === "ok") {
      revalidatePath(`/cash/${sessionId}`);
      revalidatePath("/cash");
      revalidatePath("/cash/day-close");
    }
    return toState(res, success);
  } catch (err) {
    logError("cash register: action failed", err);
    return { status: "error", message: "That didn't save. Try again — nothing is recorded twice." };
  }
}

export async function setFloatAction(_prev: CashActionState, formData: FormData): Promise<CashActionState> {
  const a = await actor();
  if (!a) return { status: "error", message: "Your session has ended. Sign in again." };
  const sessionId = formData.get("sessionId")?.toString() ?? "";
  const amountMinor = toMinor(formData.get("amount"));
  return run(sessionId, "Opening float recorded.", () => setOpeningFloat({ actor: a, sessionId, amountMinor }));
}

export async function movementAction(_prev: CashActionState, formData: FormData): Promise<CashActionState> {
  const a = await actor();
  if (!a) return { status: "error", message: "Your session has ended. Sign in again." };
  const sessionId = formData.get("sessionId")?.toString() ?? "";
  const kind = formData.get("kind") === "PAY_OUT" ? "PAY_OUT" : "PAY_IN";
  const approverUserId = formData.get("approverUserId")?.toString() ?? "";
  const pin = formData.get("pin")?.toString() ?? "";
  try {
    const res = await recordCashMovement({
      actor: a,
      sessionId,
      kind,
      amountMinor: toMinor(formData.get("amount")),
      reason: formData.get("reason")?.toString() ?? "",
      category: formData.get("category")?.toString() ?? null,
      payee: formData.get("payee")?.toString() ?? null,
      approval: approverUserId && pin ? { approverUserId, pin } : null,
      idempotencyKey: formData.get("key")?.toString() ?? "",
    });
    if (res.status === "approval_required") {
      return {
        status: "approval",
        level: res.level,
        message:
          res.level === "OWNER"
            ? "Pay-outs of Rs 10,000 or more to one payee in a shift need the owner's approval."
            : "Pay-outs above Rs 2,000 to one payee in a shift need a manager's approval.",
      };
    }
    if (res.status === "approval_refused") return { status: "approval", message: res.reason };
    if (res.status === "ok") {
      revalidatePath(`/cash/${sessionId}`);
      revalidatePath("/cash/day-close");
    }
    return toState(res, kind === "PAY_IN" ? "Cash paid in." : "Cash paid out.");
  } catch (err) {
    logError("cash register: movement failed", err);
    return { status: "error", message: "That didn't save. Try again — nothing is recorded twice." };
  }
}

export async function approveVarianceAction(_prev: CashActionState, formData: FormData): Promise<CashActionState> {
  const a = await actor();
  if (!a) return { status: "error", message: "Your session has ended. Sign in again." };
  const sessionId = formData.get("sessionId")?.toString() ?? "";
  return run(sessionId, "Difference approved.", () =>
    approveVariance({ actor: a, sessionId, note: formData.get("note")?.toString() ?? "" }),
  );
}

export async function closeCountAction(_prev: CashActionState, formData: FormData): Promise<CashActionState> {
  const a = await actor();
  if (!a) return { status: "error", message: "Your session has ended. Sign in again." };
  const sessionId = formData.get("sessionId")?.toString() ?? "";
  return run(sessionId, "Shift closed and counted.", () =>
    closeAndCount({
      actor: a,
      sessionId,
      counted: { CASH: toMinor(formData.get("CASH")), UPI: toMinor(formData.get("UPI")), CARD: toMinor(formData.get("CARD")) },
      note: formData.get("note")?.toString() ?? null,
    }),
  );
}
