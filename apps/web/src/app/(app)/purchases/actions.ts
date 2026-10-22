"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { createPurchaseReceipt, type ReceiptLineInput } from "@/server/purchasing/purchaseReceipts";

export type PurchaseActionState = {
  status: "idle" | "error" | "similar_warning";
  message?: string;
  receiptId?: string;
  existingDate?: string;
  invoiceNo?: string;
};

function parseLines(raw: string): ReceiptLineInput[] | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return null;
    return value.map((l) => ({
      sku: String(l?.sku ?? ""),
      quantity: Number(l?.quantity),
      unitCostMinor: Number(l?.unitCostMinor),
      gstRateBp: Number(l?.gstRateBp),
      priceMinor: l?.priceMinor != null && Number.isFinite(Number(l.priceMinor)) ? Number(l.priceMinor) : null,
      mrpMinor: l?.mrpMinor != null && Number.isFinite(Number(l.mrpMinor)) ? Number(l.mrpMinor) : null,
      updatePrice: Boolean(l?.updatePrice),
      pricePolicy: l?.pricePolicy === "now" ? "now" : "after_older_stock",
    }));
  } catch {
    return null;
  }
}

export async function savePurchaseAction(_prev: PurchaseActionState, formData: FormData): Promise<PurchaseActionState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const ctx = resolved.context;

  const lines = parseLines(formData.get("lines")?.toString() ?? "");
  if (!lines) return { status: "error", message: "The items could not be read. Reload the page and try again." };
  const dateRaw = formData.get("supplierInvoiceDate")?.toString() ?? "";
  const invoiceDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? new Date(`${dateRaw}T00:00:00+05:30`) : null;

  let receiptId: string;
  try {
    const res = await createPurchaseReceipt({
      actor: { tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole, membershipRole: ctx.membershipRole },
      storeId: ctx.storeId,
      supplierId: formData.get("supplierId")?.toString() ?? "",
      supplierInvoiceNo: formData.get("supplierInvoiceNo")?.toString() ?? "",
      supplierInvoiceDate: invoiceDate,
      notes: formData.get("notes")?.toString() ?? null,
      lines,
      idempotencyKey: formData.get("idempotencyKey")?.toString() ?? "",
      acknowledgeSimilarBill: formData.get("acknowledgeSimilarBill") === "true",
    });
    switch (res.status) {
      case "forbidden":
        return { status: "error", message: "Your role can't receive stock in this store." };
      case "not_found":
        return {
          status: "error",
          message: res.what === "supplier" ? "Choose an active supplier." : "This store could not be found.",
        };
      case "unknown_sku":
        return { status: "error", message: `No product has the SKU "${res.sku}". Check it, or add the product first.` };
      case "validation_error":
        return { status: "error", message: res.reason };
      case "duplicate_supplier_invoice":
        const dupDate = res.date ? new Date(res.date).toLocaleDateString("en-IN") : "earlier";
        return {
          status: "error",
          receiptId: res.receiptId,
          message: `DUPLICATE_BILL:${res.receiptId}:A bill with this invoice number from this supplier was already recorded on ${dupDate}. View Receipt #${res.receiptId.slice(-6)}.`,
        };
      case "similar_supplier_invoice":
        const simDate = res.date ? new Date(res.date).toLocaleDateString("en-IN") : "a prior period";
        return {
          status: "similar_warning",
          receiptId: res.receiptId,
          invoiceNo: res.invoiceNo,
          existingDate: simDate,
          message: `A bill with invoice number "${res.invoiceNo}" was previously recorded on ${simDate}. Do you want to continue saving as a new bill?`,
        };
    }
    receiptId = res.receiptId;
  } catch (err) {
    logError("purchases: save failed", err);
    return { status: "error", message: "Couldn't save the purchase. Nothing was received — try again." };
  }

  revalidatePath("/purchases");
  revalidatePath("/inventory");
  revalidatePath("/products");
  redirect(`/purchases/${receiptId}`);
}
