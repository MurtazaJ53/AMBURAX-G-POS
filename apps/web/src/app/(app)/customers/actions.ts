"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { createCustomer } from "@/server/sales/customers";

export type ActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  field?: string;
};

export async function createCustomerAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Unauthorized" };

  const name = formData.get("name")?.toString() ?? "";
  const phone = formData.get("phone")?.toString() || null;
  const email = formData.get("email")?.toString() || null;
  const gstin = formData.get("gstin")?.toString() || null;
  const line1 = formData.get("line1")?.toString() || null;
  const line2 = formData.get("line2")?.toString() || null;
  const city = formData.get("city")?.toString() || null;
  const state = formData.get("state")?.toString() || null;
  const postalCode = formData.get("postalCode")?.toString() || null;

  try {
    const res = await createCustomer({
      tenantId: resolved.context.tenantId,
      name,
      phone,
      email,
      gstin,
      address: line1 || city || postalCode ? {
        line1: line1 ?? "",
        line2,
        city: city ?? "",
        state,
        postalCode: postalCode ?? "",
      } : null,
    });

    if (res.status === "invalid_name") {
      return { status: "error", message: "Enter a valid name", field: "name" };
    }
    if (res.status === "validation_error") {
      return { status: "error", message: res.error, field: res.field };
    }

    revalidatePath("/customers");
    return { status: "success", message: res.existing ? "Existing customer selected." : "Customer added." };
  } catch (err) {
    return { status: "error", message: "Failed to create customer" };
  }
}
