"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { createReplenishmentRequest, setReorderRules } from "@/server/inventory/replenishment";

export type ReplenishActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

function parseUnits(raw: FormDataEntryValue | null): number | null | "invalid" {
  const value = raw?.toString().trim() ?? "";
  if (value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : "invalid";
}

/**
 * One form, two buttons: "Save levels" stores each row's reorder level and quantity; "Request stock"
 * sends the rows with a quantity to purchasing (a draft ERPNext Material Request).
 */
export async function replenishAction(_prev: ReplenishActionState, formData: FormData): Promise<ReplenishActionState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") redirect("/auth/login");
  const ctx = resolved.context;
  const actor = { tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole };
  const intent = formData.get("intent")?.toString();
  const variantIds = formData.getAll("variant").map((v) => v.toString());

  try {
    if (intent === "levels") {
      const rules: { variantId: string; reorderLevel: number | null; reorderQty: number | null }[] = [];
      for (const variantId of variantIds) {
        const level = parseUnits(formData.get(`level:${variantId}`));
        const qty = parseUnits(formData.get(`rqty:${variantId}`));
        if (level === "invalid" || qty === "invalid") return { status: "error", message: "Use whole numbers only." };
        rules.push({ variantId, reorderLevel: level, reorderQty: qty });
      }
      const res = await setReorderRules({ actor, storeId: ctx.storeId, rules });
      if (res.status === "forbidden") return { status: "error", message: "Your role can't change reorder levels here." };
      if (res.status === "validation_error") return { status: "error", message: res.reason };
      revalidatePath("/inventory/replenishment");
      const changed = res.saved + res.cleared;
      return {
        status: "success",
        message: changed === 0 ? "Nothing changed." : `Saved ${changed} reorder ${changed === 1 ? "level" : "levels"}.`,
      };
    }

    if (intent === "request") {
      const lines: { variantId: string; quantity: number }[] = [];
      for (const variantId of variantIds) {
        const q = parseUnits(formData.get(`order:${variantId}`));
        if (q === "invalid") return { status: "error", message: "Use whole numbers only." };
        if (q) lines.push({ variantId, quantity: q });
      }
      const key = formData.get("requestKey")?.toString() ?? "";
      if (key.length < 8) return { status: "error", message: "Reload the page and try again." };
      const res = await createReplenishmentRequest({
        actor,
        storeId: ctx.storeId,
        lines,
        note: formData.get("note")?.toString() ?? null,
        idempotencyKey: key,
      });
      if (res.status === "forbidden") return { status: "error", message: "Your role can't request stock here." };
      if (res.status === "validation_error") return { status: "error", message: res.reason };
      revalidatePath("/inventory/replenishment");
      return {
        status: "success",
        message: `Request sent for ${lines.length} ${lines.length === 1 ? "item" : "items"}. It goes to accounting as a draft Material Request for purchasing.`,
      };
    }
  } catch (err) {
    logError("replenishment: action failed", err);
    return { status: "error", message: "That didn't save. Try again — nothing is sent twice." };
  }
  return { status: "error", message: "Choose Save levels or Request stock." };
}
