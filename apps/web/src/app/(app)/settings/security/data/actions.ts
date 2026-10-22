"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { flushOutboxQueue, exportTenantSnapshot } from "@/server/identity/dataSecurityService";

export type DataSecurityActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  downloadData?: string;
};

async function getAuthorizedOwner() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (!session) redirect("/auth/login");
  if (session.user.tenantRole !== "OWNER") {
    throw new Error("Only owners can execute data security operations.");
  }
  return session;
}

export async function flushOutboxAction(): Promise<DataSecurityActionState> {
  try {
    const session = await getAuthorizedOwner();
    const res = await flushOutboxQueue(session.tenantId, session.userId);
    revalidatePath("/settings/security/data");
    return {
      status: "success",
      message: res.revivedEvents > 0
        ? `Re-queued ${res.revivedEvents} outbox event(s) for immediate delivery.`
        : "All outbox events are already synchronized.",
    };
  } catch (err: any) {
    return { status: "error", message: err.message || "Failed to flush outbox." };
  }
}

export async function exportTenantDataAction(): Promise<DataSecurityActionState> {
  try {
    const session = await getAuthorizedOwner();
    const data = await exportTenantSnapshot(session.tenantId, session.userId);
    return {
      status: "success",
      message: "Tenant snapshot archive generated successfully.",
      downloadData: JSON.stringify(data, null, 2),
    };
  } catch (err: any) {
    return { status: "error", message: err.message || "Failed to generate tenant export." };
  }
}
