/**
 * OpenAI ChatGPT REST Client for structured extraction, OCR, and briefings.
 *
 * Implements calls to the official OpenAI Chat Completions API (gpt-4o-mini / gpt-4o)
 * using standard fetch with the merchant's own ChatGPT API key.
 * Zero external npm dependencies.
 */

export const OPENAI_MODEL = "gpt-4o-mini";

export class OpenAiCallError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate_limited" | "unavailable" | "bad_response",
  ) {
    super(message);
  }
}

export type OpenAiMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: string | OpenAiMessageContentPart[];
}

export async function callOpenAiStructured<T>(params: {
  apiKey: string;
  messages: OpenAiMessage[];
  responseFormatJson?: boolean;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 90_000);

  const url = "https://api.openai.com/v1/chat/completions";

  const bodyPayload: Record<string, unknown> = {
    model: params.model ?? OPENAI_MODEL,
    messages: params.messages,
    temperature: params.temperature ?? 0.1,
  };

  if (params.responseFormatJson !== false) {
    bodyPayload.response_format = { type: "json_object" };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${params.apiKey.trim()}`,
      },
      body: JSON.stringify(bodyPayload),
    });
  } catch {
    throw new OpenAiCallError("The OpenAI service did not respond. Check your connection.", "unavailable");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new OpenAiCallError("Your OpenAI ChatGPT API key was rejected or invalid. Check it in Settings → AI.", "auth");
  }
  if (res.status === 429) {
    throw new OpenAiCallError("OpenAI quota exceeded or rate limit reached. Check your billing or try again.", "rate_limited");
  }
  if (!res.ok) {
    throw new OpenAiCallError(`OpenAI service returned an error (${res.status}). Try again.`, "unavailable");
  }

  const json = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;

  const rawText = json?.choices?.[0]?.message?.content;
  if (!rawText) {
    throw new OpenAiCallError("OpenAI did not return any content in the response.", "bad_response");
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new OpenAiCallError("OpenAI response was not valid JSON.", "bad_response");
  }
}
