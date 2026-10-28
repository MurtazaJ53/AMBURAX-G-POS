"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { retryFailedSync, startBackgroundSync } from "@/server/ops/operations";

export type RetryState = { status: "idle" | "error" | "success"; message?: string };

export async function retryAction(_prev: RetryState, formData: FormData): Promise<RetryState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  try {
    const res = await retryFailedSync({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole },
      eventId: formData.get("id")?.toString() ?? "",
    });
    if (res.status === "forbidden") return { status: "error", message: "Only the owner can retry." };
    if (res.status === "not_found") return { status: "error", message: "Already retried." };
  } catch (err) {
    logError("system health: retry failed", err);
    return { status: "error", message: "That didn't work. Try again." };
  }
  revalidatePath("/settings/system-health");
  return { status: "success", message: "Queued again." };
}

export async function retryAllAction(_prev: RetryState): Promise<RetryState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  try {
    const { retryAllFailedSyncs } = await import("@/server/ops/operations");
    const res = await retryAllFailedSyncs({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole },
    });
    if (res.status === "forbidden") return { status: "error", message: "Only the owner can retry all." };
    revalidatePath("/settings/system-health");
    return { status: "success", message: `Queued ${res.count} record${res.count === 1 ? "" : "s"} again.` };
  } catch (err) {
    logError("system health: retry all failed", err);
    return { status: "error", message: "That didn't work. Try again." };
  }
}

export type SyncNowState = { status: "idle" | "error" | "success"; message?: string };

export async function syncNowAction(_prev: SyncNowState): Promise<SyncNowState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  try {
    const res = startBackgroundSync({ actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole, membershipRole: c.membershipRole } });
    if (res.status === "forbidden") return { status: "error", message: "Only the owner or a store manager can sync." };
    if (res.status === "already_running") return { status: "success", message: "Sync is running in background. Live progress updating below." };
    return { status: "success", message: "Sync started in background. Live progress updating below." };
  } catch (err) {
    logError("system health: sync now failed", err);
    return { status: "error", message: "Sync didn't run. Check that accounting is reachable and try again." };
  }
}
