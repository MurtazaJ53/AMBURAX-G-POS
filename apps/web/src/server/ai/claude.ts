/**
 * One structured call to Anthropic's Messages API with the owner's key. The model must answer by
 * calling `tool` (forced tool use), so the result is JSON in the shape we asked for, never prose.
 * No SDK dependency: a plain HTTPS request with a timeout.
 */

export const AI_MODEL = "claude-sonnet-5-5";

export type ClaudeContent =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

export class AiCallError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate_limited" | "unavailable" | "bad_response",
  ) {
    super(message);
  }
}

export async function callClaudeTool<T>(params: {
  apiKey: string;
  system: string;
  content: ClaudeContent[];
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 90_000);
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: params.maxTokens ?? 8000,
        system: params.system,
        tools: [params.tool],
        tool_choice: { type: "tool", name: params.tool.name },
        messages: [{ role: "user", content: params.content }],
      }),
    });
  } catch {
    throw new AiCallError("The AI service didn't answer. Check the internet connection and try again.", "unavailable");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new AiCallError("The AI key was refused. Check it in Settings → AI.", "auth");
  if (res.status === 429) throw new AiCallError("The AI service is busy or the key's limit was reached. Try again in a minute.", "rate_limited");
  if (!res.ok) throw new AiCallError(`The AI service returned an error (${res.status}). Try again.`, "unavailable");
  const body = (await res.json().catch(() => null)) as { content?: { type: string; name?: string; input?: unknown }[] } | null;
  const call = body?.content?.find((c) => c.type === "tool_use" && c.name === params.tool.name);
  if (!call?.input) throw new AiCallError("The AI couldn't read that. Try a clearer photo.", "bad_response");
  return call.input as T;
}
