"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { recordStockTake } from "@/server/inventory/inventoryService";

export type CountActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  matched?: number;
  adjusted?: { name: string; delta: number }[];
};

/**
 * Record every counted line on the sheet. Each line goes through recordStockTake on its own
 * key derived from the sheet's key, so resubmitting the same sheet never counts a line twice.
 */
export async function submitCountAction(_prev: CountActionState, formData: FormData): Promise<CountActionState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") redirect("/auth/login");
  const ctx = resolved.context;
  const sheetKey = formData.get("sheetKey")?.toString() ?? "";
  if (sheetKey.length < 8) return { status: "error", message: "Reload the page and count again." };

  const counts: { variantId: string; name: string; counted: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("count:")) continue;
    const raw = value.toString().trim();
    if (raw === "") continue;
    const counted = Number(raw);
    if (!Number.isInteger(counted) || counted < 0) {
      return { status: "error", message: "Counts must be whole numbers, zero or more." };
    }
    const variantId = key.slice(6);
    counts.push({ variantId, name: formData.get(`name:${variantId}`)?.toString() ?? "", counted });
  }
  if (counts.length === 0) return { status: "error", message: "Enter at least one count." };

  const correlationId = randomUUID();
  let matched = 0;
  const adjusted: { name: string; delta: number }[] = [];
  try {
    for (const c of counts) {
      const res = await recordStockTake({
        actor: { tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole },
        storeId: ctx.storeId,
        variantId: c.variantId,
        countedQuantity: c.counted,
        reason: formData.get("reason")?.toString() || null,
        requestKey: `${sheetKey}:${c.variantId}`,
        correlationId,
      });
      if (res.status === "forbidden") return { status: "error", message: "Your role can't record stock counts here." };
      if (res.status !== "ok") return { status: "error", message: `Couldn't record the count for ${c.name}.` };
      if (res.delta === 0) matched += 1;
      else adjusted.push({ name: c.name, delta: res.delta });
    }
  } catch (err) {
    logError("stock-take: submit failed", err);
    return {
      status: "error",
      message: "The count stopped part-way. Lines already saved are kept; submit again to finish — nothing is counted twice.",
    };
  }
  revalidatePath("/inventory");
  revalidatePath("/inventory/stock-take");
  return { status: "success", matched, adjusted };
}
