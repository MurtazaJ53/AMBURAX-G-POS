"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { setVarianceAccounts } from "@/server/pos/varianceAccounts";

export type VarianceAccountsState = { status: "idle" | "success" | "error"; message?: string };

export async function saveVarianceAccountsAction(_prev: VarianceAccountsState, formData: FormData): Promise<VarianceAccountsState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  try {
    const res = await setVarianceAccounts({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole, storeId: c.storeId },
      cashAccount: formData.get("cash")?.toString() ?? "",
      overShortAccount: formData.get("overShort")?.toString() ?? "",
      reason: formData.get("reason")?.toString() ?? "",
    });
    if (res.status === "forbidden") return { status: "error", message: "Only the owner or the accountant can set these." };
    if (res.status === "company_unavailable") return { status: "error", message: "This store isn't linked to a company." };
    if (res.status === "validation_error") return { status: "error", message: res.reason };
    revalidatePath("/settings");
    return {
      status: "success",
      message: res.requeued > 0 ? `Saved. ${res.requeued} approved till differences are being posted to accounting.` : "Saved.",
    };
  } catch (err) {
    logError("settings: variance accounts failed", err);
    return { status: "error", message: "That didn't save. Try again." };
  }
}
