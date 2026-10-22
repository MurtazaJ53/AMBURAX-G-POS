"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolveSession } from "@/server/identity/session";
import { selectActiveStore } from "@/server/tenant/storeSelection";

export type SelectStoreState = { status: "idle" | "error"; message?: string };

/** A12: make the chosen store this session's working store, then open the dashboard. */
export async function selectStoreAction(_prev: SelectStoreState, formData: FormData): Promise<SelectStoreState> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (!session) redirect("/auth/login");

  const storeId = formData.get("storeId")?.toString() ?? "";
  if (!storeId) return { status: "error", message: "Choose the store you want to work in." };

  try {
    const res = await selectActiveStore({
      sessionId: session.id,
      tenantId: session.tenantId,
      userId: session.userId,
      tenantRole: session.user.tenantRole === "OWNER" ? "OWNER" : "STAFF",
      storeId,
    });
    if (res.status === "forbidden") {
      return { status: "error", message: "You don't have access to that store any more. Choose another." };
    }
  } catch (err) {
    logError("select-store: switch failed", err);
    return { status: "error", message: "Couldn't open that store. Try again." };
  }
  redirect("/dashboard");
}

export async function switchStoreDirectAction(storeId: string): Promise<{ success: boolean; message?: string }> {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (!session) return { success: false, message: "Authentication required" };

  if (!storeId) return { success: false, message: "No store specified" };

  try {
    const res = await selectActiveStore({
      sessionId: session.id,
      tenantId: session.tenantId,
      userId: session.userId,
      tenantRole: session.user.tenantRole === "OWNER" ? "OWNER" : "STAFF",
      storeId,
    });
    if (res.status === "forbidden") {
      return { success: false, message: "You don't have access to that store" };
    }
    return { success: true };
  } catch (err) {
    logError("switchStoreDirectAction failed", err);
    return { success: false, message: "Could not switch store. Please try again." };
  }
}

