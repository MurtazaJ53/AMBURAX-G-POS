"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { cancelPurchaseOrder, createPurchaseOrder, getPurchaseOrder, type OrderLineInput } from "@/server/purchasing/purchaseOrders";
import { createPurchaseReceipt } from "@/server/purchasing/purchaseReceipts";

export type OrderActionState = { status: "idle" | "error" | "success"; message?: string };

function istDate(raw: string): Date | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00+05:30`) : null;
}

async function context() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  return resolved.status === "ok" ? resolved.context : null;
}

function parseLines(raw: string): OrderLineInput[] | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return null;
    return value.map((l) => ({
      sku: String(l?.sku ?? ""),
      quantity: Number(l?.quantity),
      unitCostMinor: Number(l?.unitCostMinor),
      gstRateBp: Number(l?.gstRateBp),
    }));
  } catch {
    return null;
  }
}

/** Place a purchase order (screen 47). */
export async function createOrderAction(_prev: OrderActionState, formData: FormData): Promise<OrderActionState> {
  const ctx = await context();
  if (!ctx) return { status: "error", message: "Your session has ended. Sign in again." };
  const lines = parseLines(formData.get("lines")?.toString() ?? "");
  if (!lines) return { status: "error", message: "The items could not be read. Reload the page and try again." };

  let orderId: string;
  try {
    const res = await createPurchaseOrder({
      actor: { tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole, membershipRole: ctx.membershipRole },
      storeId: ctx.storeId,
      supplierId: formData.get("supplierId")?.toString() ?? "",
      expectedDate: istDate(formData.get("expectedDate")?.toString() ?? ""),
      notes: formData.get("notes")?.toString() ?? null,
      lines,
      idempotencyKey: formData.get("idempotencyKey")?.toString() ?? "",
    });
    switch (res.status) {
      case "forbidden":
        return { status: "error", message: "Your role can't place orders for this store." };
      case "not_found":
        return { status: "error", message: res.what === "supplier" ? "Choose an active supplier." : "This store could not be found." };
      case "unknown_sku":
        return { status: "error", message: `No product has the SKU "${res.sku}".` };
      case "validation_error":
        return { status: "error", message: res.reason };
    }
    orderId = res.orderId;
  } catch (err) {
    logError("purchase orders: create failed", err);
    return { status: "error", message: "Couldn't save the order. Nothing was placed — try again." };
  }
  revalidatePath("/purchases/orders");
  redirect(`/purchases/orders/${orderId}`);
}

/** Receive goods against an order (screen 48): one purchase receipt citing the order's lines. */
export async function receiveOrderAction(_prev: OrderActionState, formData: FormData): Promise<OrderActionState> {
  const ctx = await context();
  if (!ctx) return { status: "error", message: "Your session has ended. Sign in again." };
  const orderId = formData.get("orderId")?.toString() ?? "";
  const order = await getPurchaseOrder({ tenantId: ctx.tenantId, orderId });
  if (!order) return { status: "error", message: "This order could not be found." };

  const lines = [];
  for (const l of order.lines) {
    const raw = formData.get(`qty:${l.id}`)?.toString().trim() ?? "";
    if (raw === "" || raw === "0") continue;
    const q = Number(raw);
    if (!Number.isInteger(q) || q < 0) return { status: "error", message: "Quantities are whole numbers." };
    lines.push({ sku: l.variant.sku, quantity: q, unitCostMinor: l.unitCostMinor, gstRateBp: l.gstRateBp, purchaseOrderLineId: l.id });
  }
  if (lines.length === 0) return { status: "error", message: "Enter what arrived for at least one item." };

  let receiptId: string;
  try {
    const res = await createPurchaseReceipt({
      actor: { tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole, membershipRole: ctx.membershipRole },
      storeId: order.storeId,
      supplierId: order.supplierId,
      supplierInvoiceNo: formData.get("supplierInvoiceNo")?.toString() ?? "",
      supplierInvoiceDate: istDate(formData.get("supplierInvoiceDate")?.toString() ?? ""),
      lines,
      purchaseOrderId: order.id,
      idempotencyKey: formData.get("idempotencyKey")?.toString() ?? "",
    });
    switch (res.status) {
      case "forbidden":
        return { status: "error", message: "Your role can't receive stock in this store." };
      case "not_found":
        return {
          status: "error",
          message: res.what === "supplier" ? "The supplier is no longer active." : "The order or store could not be found.",
        };
      case "unknown_sku":
        return { status: "error", message: `No product has the SKU "${res.sku}".` };
      case "validation_error":
        return { status: "error", message: res.reason };
    }
    receiptId = res.receiptId;
  } catch (err) {
    logError("purchase orders: receive failed", err);
    return { status: "error", message: "Couldn't record the delivery. Nothing was received — try again." };
  }
  revalidatePath(`/purchases/orders/${order.id}`);
  revalidatePath("/inventory");
  redirect(`/purchases/${receiptId}`);
}

export async function cancelOrderAction(_prev: OrderActionState, formData: FormData): Promise<OrderActionState> {
  const ctx = await context();
  if (!ctx) return { status: "error", message: "Your session has ended. Sign in again." };
  const orderId = formData.get("orderId")?.toString() ?? "";
  try {
    const res = await cancelPurchaseOrder({
      actor: { tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole, membershipRole: ctx.membershipRole },
      orderId,
    });
    if (res.status === "forbidden") return { status: "error", message: "Your role can't cancel orders." };
    if (res.status === "not_found") return { status: "error", message: "This order could not be found." };
    if (res.status === "conflict") return { status: "error", message: res.reason };
  } catch (err) {
    logError("purchase orders: cancel failed", err);
    return { status: "error", message: "Couldn't cancel the order. Try again." };
  }
  revalidatePath(`/purchases/orders/${orderId}`);
  revalidatePath("/purchases/orders");
  return { status: "success", message: "Order cancelled." };
}
