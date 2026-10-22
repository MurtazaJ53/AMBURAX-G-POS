"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { requestErpConnection } from "@/server/erp/tenantProvisioning";
import { turnOnGst } from "@/server/catalog/gstSetup";

export type ConnectState = { status: "idle" | "error" | "success"; message?: string };

export async function connectErpAction(_prev: ConnectState): Promise<ConnectState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  try {
    const res = await requestErpConnection({ actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole } });
    if (res.status === "forbidden") return { status: "error", message: "Only the owner can connect the business." };
    revalidatePath("/settings/company");
    return {
      status: "success",
      message: res.status === "already_connected" ? "Already connected." : "Connecting. This page updates when it's done.",
    };
  } catch (err) {
    logError("company: connect failed", err);
    return { status: "error", message: "That didn't start. Try again." };
  }
}

export type GstState = { status: "idle" | "error" | "success"; message?: string; needsReview?: number };

/** Owner turns GST on with the business's GSTIN (owner decision 2026-10-16, option A). */
export async function turnOnGstAction(_prev: GstState, formData: FormData): Promise<GstState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  if (formData.get("confirm") !== "yes") return { status: "error", message: "Tick the box to confirm you are GST-registered from today." };
  try {
    const res = await turnOnGst({ actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole }, gstin: formData.get("gstin")?.toString() ?? "" });
    if (res.status === "forbidden") return { status: "error", message: "Only the owner can turn on GST." };
    if (res.status === "already_registered") return { status: "error", message: "GST is already on for this business." };
    if (res.status === "invalid") return { status: "error", message: res.reason };
    revalidatePath("/settings/company");
    revalidatePath("/products");
    revalidatePath("/pos");
    return {
      status: "success",
      needsReview: res.needsReview,
      message:
        res.needsReview > 0
          ? `GST is on. ${res.needsReview.toLocaleString("en-IN")} products need a GST type before they can be sold.`
          : "GST is on.",
    };
  } catch (err) {
    logError("company: turn on gst failed", err);
    return { status: "error", message: "That didn't work. Try again." };
  }
}
