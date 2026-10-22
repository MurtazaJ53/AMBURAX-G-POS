"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { cancelTransfer, receiveTransfer, sendTransfer } from "@/server/inventory/stockTransfers";

export type TransferActionState = { status: "idle" | "success" | "error"; message?: string };

async function context() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") redirect("/auth/login");
  return resolved.context;
}

export async function sendTransferAction(_prev: TransferActionState, formData: FormData): Promise<TransferActionState> {
  const ctx = await context();
  let lines: { sku: string; quantity: number }[];
  try {
    const raw: unknown = JSON.parse(formData.get("lines")?.toString() ?? "[]");
    if (!Array.isArray(raw)) throw new Error("lines");
    lines = raw
      .map((l) => ({ sku: String(l?.sku ?? "").trim(), quantity: Number(l?.quantity) }))
      .filter((l) => l.sku);
  } catch {
    return { status: "error", message: "The items could not be read. Reload and try again." };
  }
  let transferId: string;
  try {
    const res = await sendTransfer({
      actor: { tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole },
      fromStoreId: ctx.storeId,
      toStoreId: formData.get("toStoreId")?.toString() ?? "",
      lines,
      note: formData.get("note")?.toString() ?? null,
      idempotencyKey: formData.get("idempotencyKey")?.toString() ?? "",
    });
    if (res.status === "forbidden") return { status: "error", message: "Your role can't send stock from this store." };
    if (res.status === "unknown_sku") return { status: "error", message: `No product has the SKU "${res.sku}".` };
    if (res.status === "validation_error") return { status: "error", message: res.reason };
    transferId = res.transferId;
  } catch (err) {
    logError("transfers: send failed", err);
    return { status: "error", message: "Couldn't send the transfer. Nothing was moved — try again." };
  }
  revalidatePath("/inventory");
  redirect(`/inventory/transfers/${transferId}`);
}

export async function receiveTransferAction(_prev: TransferActionState, formData: FormData): Promise<TransferActionState> {
  const ctx = await context();
  const transferId = formData.get("transferId")?.toString() ?? "";
  const received: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("recv:")) continue;
    const n = Number(value.toString().trim());
    if (!Number.isInteger(n) || n < 0) return { status: "error", message: "Received quantities must be whole numbers." };
    received[key.slice(5)] = n;
  }
  try {
    const res = await receiveTransfer({
      actor: { tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole },
      transferId,
      received,
    });
    if (res.status === "forbidden") {
      return { status: "error", message: "Only the receiving store's inventory team can receive this." };
    }
    if (res.status === "not_found") return { status: "error", message: "This transfer could not be found." };
    if (res.status === "not_in_transit") {
      return { status: "error", message: "This transfer has already been received or cancelled." };
    }
    if (res.status === "validation_error") return { status: "error", message: res.reason };
    revalidatePath(`/inventory/transfers/${transferId}`);
    revalidatePath("/inventory");
    return {
      status: "success",
      message:
        res.shortUnits > 0
          ? `Received, with ${res.shortUnits} units short — recorded on the transfer.`
          : "Received in full. Stock added to this store.",
    };
  } catch (err) {
    logError("transfers: receive failed", err);
    return { status: "error", message: "Couldn't receive the transfer. Nothing was changed — try again." };
  }
}

export async function cancelTransferAction(_prev: TransferActionState, formData: FormData): Promise<TransferActionState> {
  const ctx = await context();
  const transferId = formData.get("transferId")?.toString() ?? "";
  try {
    const res = await cancelTransfer({
      actor: { tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole },
      transferId,
    });
    if (res.status === "forbidden") {
      return { status: "error", message: "Only the sending store's inventory team can cancel this." };
    }
    if (res.status === "not_found") return { status: "error", message: "This transfer could not be found." };
    if (res.status === "not_in_transit") {
      return { status: "error", message: "Only a transfer still in transit can be cancelled." };
    }
    revalidatePath(`/inventory/transfers/${transferId}`);
    revalidatePath("/inventory");
    return { status: "success", message: "Cancelled. The stock is back in the sending store." };
  } catch (err) {
    logError("transfers: cancel failed", err);
    return { status: "error", message: "Couldn't cancel the transfer. Try again." };
  }
}
