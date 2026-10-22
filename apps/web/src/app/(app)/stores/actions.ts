"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { addStore } from "@/server/tenant/addStore";

export type AddStoreState = { status: "idle" | "error" | "success"; message?: string; field?: string; nonce?: number };

export async function addStoreAction(_prev: AddStoreState, formData: FormData): Promise<AddStoreState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const v = (k: string) => formData.get(k)?.toString() ?? "";
  try {
    const res = await addStore({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole },
      name: v("name"),
      code: v("code"),
      phone: v("phone") || null,
      addressLine: v("addressLine"),
      city: v("city"),
      state: v("state"),
      postalCode: v("postalCode") || null,
    });
    if (res.status === "forbidden") return { status: "error", message: "Only the owner can add a store." };
    if (res.status === "conflict") return { status: "error", field: "code", message: res.reason };
    if (res.status === "validation_error") return { status: "error", field: res.field, message: res.reason };
  } catch (err) {
    logError("stores: add failed", err);
    return { status: "error", message: "That didn't save. Try again." };
  }
  revalidatePath("/stores");
  return { status: "success", nonce: Date.now(), message: "Store added. Its Backend warehouse is being set up." };
}
