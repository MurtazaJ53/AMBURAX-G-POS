"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { confirmPhoneCode, sendPhoneCode } from "@/server/khata/phoneVerification";

export type PhoneState = { status: "idle" | "sent" | "verified" | "error"; message?: string };

async function actor() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  return resolved.status === "ok" && resolved.context.canSell
    ? { tenantId: resolved.context.tenantId, userId: resolved.context.userId }
    : null;
}

/** Q9: send a one-time code to the customer's phone, or check the code they read back. */
export async function phoneAction(_prev: PhoneState, formData: FormData): Promise<PhoneState> {
  const a = await actor();
  if (!a) return { status: "error", message: "Your role can't verify customer phones here." };
  const customerId = formData.get("customerId")?.toString() ?? "";
  try {
    if (formData.get("intent") === "send") {
      const res = await sendPhoneCode({ actor: a, customerId });
      switch (res.status) {
        case "ok":
          return { status: "sent", message: "Code sent. Ask the customer to read it out." };
        case "too_soon":
          return { status: "sent", message: `A code was just sent. Wait ${res.retryAfterSeconds}s to send another.` };
        case "already_verified":
          return { status: "verified", message: "This phone is already verified." };
        case "no_phone":
          return { status: "error", message: "Add a mobile number first." };
        default:
          return { status: "error", message: "Customer not found." };
      }
    }
    const res = await confirmPhoneCode({ actor: a, customerId, code: formData.get("code")?.toString() ?? "" });
    switch (res.status) {
      case "ok":
        revalidatePath(`/customers/${customerId}`);
        return { status: "verified", message: "Phone verified." };
      case "wrong_code":
        return { status: "sent", message: `That code doesn't match. ${res.attemptsLeft} tries left.` };
      case "expired":
        return { status: "error", message: "That code has expired. Send a new one." };
      case "too_many_attempts":
        return { status: "error", message: "Too many wrong codes. Send a new one." };
      case "phone_changed":
        return { status: "error", message: "The phone number changed after the code was sent. Send a new one." };
      default:
        return { status: "error", message: "Send a code first." };
    }
  } catch (err) {
    logError("customer phone verification failed", err);
    return { status: "error", message: "That didn't work. Try again." };
  }
}
