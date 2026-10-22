"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import {
  canManageSuppliers,
  createSupplier,
  setSupplierActive,
  updateSupplier,
  type SupplierInput,
} from "@/server/purchasing/suppliers";

export type SupplierActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  field?: string;
};

async function writer() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { ok: false as const, message: "Your session has ended. Sign in again." };
  if (!canManageSuppliers(resolved.context)) {
    return { ok: false as const, message: "Only an owner or store manager can change suppliers." };
  }
  return { ok: true as const, context: resolved.context };
}

function inputFrom(formData: FormData): SupplierInput {
  const get = (k: string) => formData.get(k)?.toString() ?? null;
  return {
    name: get("name") ?? "",
    contactName: get("contactName"),
    phone: get("phone"),
    email: get("email"),
    gstin: get("gstin"),
    city: get("city"),
    notes: get("notes"),
  };
}

export async function saveSupplierAction(
  _prev: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  const w = await writer();
  if (!w.ok) return { status: "error", message: w.message };
  const supplierId = formData.get("supplierId")?.toString() || null;

  try {
    const base = { tenantId: w.context.tenantId, actorUserId: w.context.userId, input: inputFrom(formData) };
    const res = supplierId ? await updateSupplier({ ...base, supplierId }) : await createSupplier(base);
    if (res.status === "validation_error") return { status: "error", message: res.error, field: res.field };
    if (res.status === "duplicate_name") {
      return { status: "error", message: "A supplier with this name already exists.", field: "name" };
    }
    if (res.status === "not_found") return { status: "error", message: "This supplier no longer exists." };
    revalidatePath("/suppliers");
    return { status: "success", message: supplierId ? "Supplier updated." : "Supplier added." };
  } catch (err) {
    logError("suppliers: save failed", err);
    return { status: "error", message: "Couldn't save the supplier. Try again." };
  }
}

export async function toggleSupplierActiveAction(
  _prev: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  const w = await writer();
  if (!w.ok) return { status: "error", message: w.message };
  const supplierId = formData.get("supplierId")?.toString() ?? "";
  const isActive = formData.get("isActive") === "true";
  try {
    const res = await setSupplierActive({
      tenantId: w.context.tenantId,
      actorUserId: w.context.userId,
      supplierId,
      isActive,
    });
    if (res.status === "not_found") return { status: "error", message: "This supplier no longer exists." };
    revalidatePath("/suppliers");
    return { status: "success", message: isActive ? "Supplier reactivated." : "Supplier deactivated." };
  } catch (err) {
    logError("suppliers: status change failed", err);
    return { status: "error", message: "Couldn't change the supplier's status. Try again." };
  }
}
