"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageLeads, createLead, moveLeadStage, updateLead, type LeadInput } from "@/server/b2b/leads";

export type LeadActionState = { status: "idle" | "success" | "error"; message?: string; field?: string };

async function writer() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { ok: false as const, message: "Your session has ended. Sign in again." };
  if (!canManageLeads(resolved.context)) {
    return { ok: false as const, message: "Only an owner or store manager can change leads." };
  }
  return { ok: true as const, context: resolved.context };
}

function inputFrom(formData: FormData): LeadInput {
  const get = (k: string) => formData.get(k)?.toString() ?? null;
  return {
    company: get("company") ?? "",
    contactName: get("contactName"),
    phone: get("phone"),
    email: get("email"),
    city: get("city"),
    source: get("source"),
    notes: get("notes"),
    stage: get("stage"),
  };
}

export async function saveLeadAction(_prev: LeadActionState, formData: FormData): Promise<LeadActionState> {
  const w = await writer();
  if (!w.ok) return { status: "error", message: w.message };
  const leadId = formData.get("leadId")?.toString() || null;
  try {
    const base = { tenantId: w.context.tenantId, actorUserId: w.context.userId, input: inputFrom(formData) };
    const res = leadId ? await updateLead({ ...base, leadId }) : await createLead(base);
    if (res.status === "validation_error") return { status: "error", message: res.error, field: res.field };
    if (res.status === "not_found") return { status: "error", message: "This lead no longer exists." };
    revalidatePath("/b2b");
    return { status: "success", message: leadId ? "Lead updated." : "Lead added." };
  } catch (err) {
    logError("b2b: save lead failed", err);
    return { status: "error", message: "Couldn't save the lead. Try again." };
  }
}

export async function moveLeadAction(_prev: LeadActionState, formData: FormData): Promise<LeadActionState> {
  const w = await writer();
  if (!w.ok) return { status: "error", message: w.message };
  try {
    const res = await moveLeadStage({
      tenantId: w.context.tenantId,
      actorUserId: w.context.userId,
      leadId: formData.get("leadId")?.toString() ?? "",
      stage: formData.get("stage")?.toString() ?? "",
    });
    if (res.status === "not_found") return { status: "error", message: "This lead no longer exists." };
    if (res.status === "invalid_stage") return { status: "error", message: "Choose a valid stage." };
    revalidatePath("/b2b");
    return { status: "success" };
  } catch (err) {
    logError("b2b: move lead failed", err);
    return { status: "error", message: "Couldn't move the lead. Try again." };
  }
}

export async function convertLeadAction(_prev: LeadActionState, formData: FormData): Promise<LeadActionState> {
  const w = await writer();
  if (!w.ok) return { status: "error", message: w.message };
  const leadId = formData.get("leadId")?.toString() ?? "";
  try {
    const { convertLeadToOrder } = await import("@/server/b2b/leads");
    const res = await convertLeadToOrder({
      tenantId: w.context.tenantId,
      actorUserId: w.context.userId,
      leadId,
      storeId: w.context.storeId,
    });
    if (res.status === "error") return { status: "error", message: res.reason };
    revalidatePath("/b2b");
    return { status: "success", message: `Converted to wholesale Order #${res.orderNumber}!` };
  } catch (err) {
    logError("b2b: convert lead failed", err);
    return { status: "error", message: "Couldn't convert lead. Try again." };
  }
}
