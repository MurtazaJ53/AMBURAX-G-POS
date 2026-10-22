"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolveSession } from "@/server/identity/session";
import {
  changeOwnPassword,
  revokeOtherSessions,
  revokeOwnSession,
  setOwnIdleTimeout,
  setOwnMfa,
} from "@/server/identity/securityCenter";
import {
  addTrustedNetwork,
  removeTrustedNetwork,
  updateSecurityPreferences,
  updateTenantPolicyMode,
} from "@/server/identity/advancedSecurity";

export type SecurityActionState = { status: "idle" | "success" | "error"; message?: string; field?: string };

async function currentSession() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (!session) redirect("/auth/login");
  return session;
}

export async function changePasswordAction(_prev: SecurityActionState, formData: FormData): Promise<SecurityActionState> {
  const session = await currentSession();
  const next = formData.get("newPassword")?.toString() ?? "";
  if (next !== (formData.get("confirmPassword")?.toString() ?? "")) {
    return { status: "error", message: "The new passwords don't match.", field: "confirmPassword" };
  }
  try {
    const res = await changeOwnPassword({
      userId: session.userId,
      tenantId: session.tenantId,
      currentSessionId: session.id,
      currentPassword: formData.get("currentPassword")?.toString() ?? "",
      newPassword: next,
    });
    switch (res.status) {
      case "wrong_password":
        return { status: "error", message: "Your current password isn't right.", field: "currentPassword" };
      case "weak_password":
        return { status: "error", message: res.reason, field: "newPassword" };
      case "same_password":
        return { status: "error", message: "Choose a password you haven't been using.", field: "newPassword" };
    }
    revalidatePath("/settings/security");
    return {
      status: "success",
      message:
        res.signedOutOthers > 0
          ? `Password changed. ${res.signedOutOthers} other ${res.signedOutOthers === 1 ? "device was" : "devices were"} signed out.`
          : "Password changed.",
    };
  } catch (err) {
    logError("security: change password failed", err);
    return { status: "error", message: "Couldn't change your password. Try again." };
  }
}

export async function setMfaAction(_prev: SecurityActionState, formData: FormData): Promise<SecurityActionState> {
  const session = await currentSession();
  const enabled = formData.get("enabled") === "true";
  try {
    const res = await setOwnMfa({
      userId: session.userId,
      tenantId: session.tenantId,
      password: formData.get("password")?.toString() ?? "",
      enabled,
    });
    if (res.status === "wrong_password") return { status: "error", message: "That password isn't right.", field: "password" };
    if (res.status === "delivery_unavailable") {
      return {
        status: "error",
        message: "Two-step sign-in needs an email or SMS provider to deliver codes, and none is connected yet.",
      };
    }
    revalidatePath("/settings/security");
    return {
      status: "success",
      message: enabled
        ? "Two-step sign-in is on. You'll enter a one-time code after your password next time."
        : "Two-step sign-in is off.",
    };
  } catch (err) {
    logError("security: set mfa failed", err);
    return { status: "error", message: "Couldn't change two-step sign-in. Try again." };
  }
}

export async function revokeSessionAction(_prev: SecurityActionState, formData: FormData): Promise<SecurityActionState> {
  const session = await currentSession();
  const sessionId = formData.get("sessionId")?.toString() ?? "";
  let signedOutHere = false;
  try {
    const res = await revokeOwnSession({ userId: session.userId, tenantId: session.tenantId, sessionId });
    if (res.status === "not_found") return { status: "error", message: "That session has already ended." };
    signedOutHere = sessionId === session.id;
  } catch (err) {
    logError("security: revoke session failed", err);
    return { status: "error", message: "Couldn't sign that device out. Try again." };
  }
  if (signedOutHere) {
    (await cookies()).delete(env.SESSION_COOKIE_NAME);
    redirect("/auth/login");
  }
  revalidatePath("/settings/security/sessions");
  return { status: "success", message: "Device signed out." };
}

export async function revokeOthersAction(_prev: SecurityActionState): Promise<SecurityActionState> {
  const session = await currentSession();
  try {
    const { revoked } = await revokeOtherSessions({
      userId: session.userId,
      tenantId: session.tenantId,
      keepSessionId: session.id,
    });
    revalidatePath("/settings/security/sessions");
    return {
      status: "success",
      message:
        revoked === 0
          ? "No other devices were signed in."
          : `Signed out ${revoked} other ${revoked === 1 ? "device" : "devices"}.`,
    };
  } catch (err) {
    logError("security: revoke others failed", err);
    return { status: "error", message: "Couldn't sign other devices out. Try again." };
  }
}

export async function setIdleTimeoutAction(_prev: SecurityActionState, formData: FormData): Promise<SecurityActionState> {
  const session = await currentSession();
  const raw = formData.get("minutes")?.toString() ?? "";
  const minutes = raw === "off" ? null : Number(raw);
  try {
    const res = await setOwnIdleTimeout({ userId: session.userId, tenantId: session.tenantId, minutes });
    if (res.status === "invalid") return { status: "error", message: "Choose one of the listed times." };
    revalidatePath("/settings/security");
    return {
      status: "success",
      message: minutes === null ? "Idle sign-out is off." : `You'll be signed out after ${minutes} minutes without activity.`,
    };
  } catch (err) {
    logError("security: set idle timeout failed", err);
    return { status: "error", message: "Couldn't save that. Try again." };
  }
}

export async function updateSignInAlertsAction(_prev: SecurityActionState, formData: FormData): Promise<SecurityActionState> {
  const session = await currentSession();
  const signInAlertsEnabled = formData.get("enabled") === "true";
  const alertOnNewDeviceOnly = formData.get("newDeviceOnly") === "true";
  const notifyEmail = formData.get("notifyEmail") === "true";
  const notifySms = formData.get("notifySms") === "true";

  try {
    await updateSecurityPreferences({
      userId: session.userId,
      tenantId: session.tenantId,
      signInAlertsEnabled,
      alertOnNewDeviceOnly,
      notifyEmail,
      notifySms,
    });
    revalidatePath("/settings/security");
    return {
      status: "success",
      message: signInAlertsEnabled ? "Sign-in alerts enabled." : "Sign-in alerts disabled.",
    };
  } catch (err) {
    logError("security: update alerts failed", err);
    return { status: "error", message: "Couldn't update alert preferences." };
  }
}

export async function updateLocationPolicyAction(_prev: SecurityActionState, formData: FormData): Promise<SecurityActionState> {
  const session = await currentSession();
  if (session.user.tenantRole !== "OWNER") {
    return { status: "error", message: "Only the business owner can configure location restrictions." };
  }

  const mode = formData.get("mode")?.toString() as "OFF" | "WARN" | "ENFORCE_STAFF_ONLY" | "ENFORCE_ALL";
  if (!["OFF", "WARN", "ENFORCE_STAFF_ONLY", "ENFORCE_ALL"].includes(mode)) {
    return { status: "error", message: "Invalid policy mode chosen." };
  }

  try {
    await updateTenantPolicyMode({
      tenantId: session.tenantId,
      userId: session.userId,
      enforcementMode: mode,
    });
    revalidatePath("/settings/security");
    return {
      status: "success",
      message: "Location restriction policy updated.",
    };
  } catch (err) {
    logError("security: update policy failed", err);
    return { status: "error", message: "Couldn't update location policy." };
  }
}

export async function addTrustedNetworkAction(_prev: SecurityActionState, formData: FormData): Promise<SecurityActionState> {
  const session = await currentSession();
  if (session.user.tenantRole !== "OWNER") {
    return { status: "error", message: "Only the business owner can manage trusted networks." };
  }

  const label = formData.get("label")?.toString().trim() ?? "";
  const cidr = formData.get("cidr")?.toString().trim() ?? "";

  if (!label || !cidr) {
    return { status: "error", message: "Label and IP / CIDR are both required." };
  }

  try {
    await addTrustedNetwork({
      tenantId: session.tenantId,
      userId: session.userId,
      label,
      cidr,
    });
    revalidatePath("/settings/security");
    return {
      status: "success",
      message: `Trusted network "${label}" added successfully.`,
    };
  } catch (err) {
    logError("security: add trusted network failed", err);
    return { status: "error", message: "Couldn't add trusted network. Check the IP/CIDR format." };
  }
}

export async function removeTrustedNetworkAction(_prev: SecurityActionState, formData: FormData): Promise<SecurityActionState> {
  const session = await currentSession();
  if (session.user.tenantRole !== "OWNER") {
    return { status: "error", message: "Only the business owner can manage trusted networks." };
  }

  const id = formData.get("id")?.toString() ?? "";
  try {
    await removeTrustedNetwork({
      tenantId: session.tenantId,
      id,
    });
    revalidatePath("/settings/security");
    return {
      status: "success",
      message: "Trusted network removed.",
    };
  } catch (err) {
    logError("security: remove trusted network failed", err);
    return { status: "error", message: "Couldn't remove trusted network." };
  }
}
