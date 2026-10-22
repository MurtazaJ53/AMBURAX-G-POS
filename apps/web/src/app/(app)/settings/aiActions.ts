"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { setAiKey, setGeminiKey, setOpenAiKey } from "@/server/ai/aiKey";

export type AiKeyState = { status: "idle" | "error" | "success"; message?: string };

export async function saveAiKeyAction(_prev: AiKeyState, formData: FormData): Promise<AiKeyState> {
  const resolved = await resolvePosContext((await cookies()).get(env.SESSION_COOKIE_NAME)?.value);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const remove = formData.get("remove") === "yes";
  try {
    const res = await setAiKey({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole },
      apiKey: remove ? null : (formData.get("apiKey")?.toString() ?? ""),
    });
    if (res.status === "forbidden") return { status: "error", message: "Only the owner can set the AI key." };
    if (res.status === "invalid") return { status: "error", message: res.reason };
    if (res.status === "not_configured") {
      return { status: "error", message: "This server can't store keys yet: encryption key not set." };
    }
    revalidatePath("/settings");
    return { status: "success", message: remove ? "Anthropic AI key removed." : "Anthropic Claude key saved successfully." };
  } catch (err) {
    logError("settings: ai key failed", err);
    return { status: "error", message: "Couldn't save. Try again." };
  }
}

export async function saveGeminiKeyAction(_prev: AiKeyState, formData: FormData): Promise<AiKeyState> {
  const resolved = await resolvePosContext((await cookies()).get(env.SESSION_COOKIE_NAME)?.value);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const remove = formData.get("remove") === "yes";
  try {
    const res = await setGeminiKey({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole },
      apiKey: remove ? null : (formData.get("geminiKey")?.toString() ?? ""),
    });
    if (res.status === "forbidden") return { status: "error", message: "Only the owner can set the Gemini key." };
    if (res.status === "invalid") return { status: "error", message: res.reason };
    if (res.status === "not_configured") {
      return { status: "error", message: "This server can't store keys yet: encryption key not set." };
    }
    revalidatePath("/settings");
    return { status: "success", message: remove ? "Gemini key removed." : "Google Gemini key saved successfully." };
  } catch (err) {
    logError("settings: gemini key failed", err);
    return { status: "error", message: "Couldn't save. Try again." };
  }
}

export async function saveOpenAiKeyAction(_prev: AiKeyState, formData: FormData): Promise<AiKeyState> {
  const resolved = await resolvePosContext((await cookies()).get(env.SESSION_COOKIE_NAME)?.value);
  if (resolved.status !== "ok") return { status: "error", message: "Your session has ended. Sign in again." };
  const c = resolved.context;
  const remove = formData.get("remove") === "yes";
  try {
    const res = await setOpenAiKey({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole },
      apiKey: remove ? null : (formData.get("openaiKey")?.toString() ?? ""),
    });
    if (res.status === "forbidden") return { status: "error", message: "Only the owner can set the OpenAI ChatGPT key." };
    if (res.status === "invalid") return { status: "error", message: res.reason };
    if (res.status === "not_configured") {
      return { status: "error", message: "This server can't store keys yet: encryption key not set." };
    }
    revalidatePath("/settings");
    return { status: "success", message: remove ? "OpenAI ChatGPT key removed." : "OpenAI ChatGPT key saved successfully." };
  } catch (err) {
    logError("settings: openai key failed", err);
    return { status: "error", message: "Couldn't save. Try again." };
  }
}
