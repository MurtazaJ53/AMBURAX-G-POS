"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { BULK_TREATMENTS, bulkSetGst, type BulkTreatment } from "@/server/catalog/gstSetup";

export type BulkGstState = { status: "idle" | "error" | "success"; message?: string };

/** Give the ticked products one GST type (owner or store manager). */
export async function bulkGstAction(_prev: BulkGstState, formData: FormData): Promise<BulkGstState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const treatment = formData.get("treatment")?.toString() as BulkTreatment;
  if (!BULK_TREATMENTS.includes(treatment)) return { status: "error", message: "Choose a GST type." };
  const ratePct = Number(formData.get("ratePct") ?? 0);
  try {
    const res = await bulkSetGst({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole, membershipRole: c.membershipRole },
      variantIds: formData.getAll("variantId").map(String),
      treatment,
      rateMode: formData.get("rateMode") === "APPAREL_SLAB" ? "APPAREL_SLAB" : "FIXED",
      rateBp: Number.isFinite(ratePct) ? Math.round(ratePct * 100) : 0,
      exemptionRef: formData.get("exemptionRef")?.toString() ?? null,
    });
    if (res.status === "forbidden") return { status: "error", message: "Only the owner or a store manager can set GST types." };
    if (res.status === "invalid") return { status: "error", message: res.reason };
    revalidatePath("/products/gst");
    revalidatePath("/products");
    return { status: "success", message: `${res.updated.toLocaleString("en-IN")} products updated. They can be sold now and will sync to Backend.` };
  } catch (err) {
    logError("products: bulk gst failed", err);
    return { status: "error", message: "That didn't save. Try again." };
  }
}
