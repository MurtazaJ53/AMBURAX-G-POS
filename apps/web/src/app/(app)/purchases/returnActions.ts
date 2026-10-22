"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { createPurchaseReturn } from "@/server/purchasing/purchaseReturns";

export type ReturnActionState = { status: "idle" | "success" | "error"; message?: string; key?: string };

export async function returnToSupplierAction(_prev: ReturnActionState, formData: FormData): Promise<ReturnActionState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const ctx = resolved.context;
  const receiptId = formData.get("receiptId")?.toString() ?? "";

  const lines: { receiptLineId: string; quantity: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("qty:")) continue;
    const raw = value.toString().trim();
    if (raw === "") continue;
    const quantity = Number(raw);
    if (!Number.isInteger(quantity) || quantity < 0) {
      return { status: "error", message: "Quantities must be whole numbers, zero or more." };
    }
    lines.push({ receiptLineId: key.slice(4), quantity });
  }

  try {
    const res = await createPurchaseReturn({
      actor: { tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole, membershipRole: ctx.membershipRole },
      receiptId,
      reason: formData.get("reason")?.toString() ?? "",
      lines,
      idempotencyKey: formData.get("idempotencyKey")?.toString() ?? "",
    });
    if (res.status === "forbidden") return { status: "error", message: "Your role can't send stock back to suppliers." };
    if (res.status === "not_found") return { status: "error", message: "This purchase could not be found." };
    if (res.status === "validation_error") return { status: "error", message: res.reason };
    revalidatePath(`/purchases/${receiptId}`);
    revalidatePath("/inventory");
    return {
      status: "success",
      key: formData.get("idempotencyKey")?.toString(),
      message: res.duplicate
        ? "This return was already recorded."
        : "Return recorded. The stock has been taken out of this store.",
    };
  } catch (err) {
    logError("purchases: return to supplier failed", err);
    return { status: "error", message: "Couldn't record the return. Nothing was changed — try again." };
  }
}
