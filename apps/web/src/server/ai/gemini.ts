/**
 * Google Gemini REST Client for structured extraction and OCR.
 *
 * Implements Gemini 2.5/3.8 API calls (using official Google Generative Language REST endpoint)
 * with the merchant's own Gemini API key. Zero external npm dependencies.
 */

export const GEMINI_MODEL = "gemini-2.5-flash";

export class GeminiCallError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate_limited" | "unavailable" | "bad_response",
  ) {
    super(message);
  }
}

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export async function callGeminiStructured<T>(params: {
  apiKey: string;
  systemInstruction?: string;
  parts: GeminiPart[];
  responseSchema?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 90_000);

  // The key goes in a header, never the URL: URLs end up in proxy and error logs.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  const contents = [
    {
      role: "user",
      parts: params.parts,
    },
  ];

  const bodyPayload: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  };

  if (params.systemInstruction) {
    bodyPayload.systemInstruction = {
      parts: [{ text: params.systemInstruction }],
    };
  }

  if (params.responseSchema) {
    (bodyPayload.generationConfig as Record<string, unknown>).responseSchema = params.responseSchema;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": params.apiKey.trim(),
      },
      body: JSON.stringify(bodyPayload),
    });
  } catch {
    throw new GeminiCallError("The Gemini AI service did not respond. Check your connection.", "unavailable");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 400 || res.status === 403) {
    throw new GeminiCallError("Your Gemini API key was rejected or invalid. Check it in Settings → AI.", "auth");
  }
  if (res.status === 429) {
    throw new GeminiCallError("Gemini rate limit reached or quota exceeded. Try again in a moment.", "rate_limited");
  }
  if (!res.ok) {
    throw new GeminiCallError(`Gemini service returned an error (${res.status}). Try again.`, "unavailable");
  }

  const json = (await res.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  } | null;

  const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new GeminiCallError("Gemini did not return any text in the response.", "bad_response");
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new GeminiCallError("Gemini response was not valid JSON.", "bad_response");
  }
}
