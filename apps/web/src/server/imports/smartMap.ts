import { resolveAnyAiKey } from "@/server/ai/aiKey";
import { AiCallError, callClaudeTool } from "@/server/ai/claude";
import { callGeminiStructured, GeminiCallError } from "@/server/ai/gemini";
import { callOpenAiStructured, OpenAiCallError } from "@/server/ai/openai";
import { IMPORT_FIELDS, type ImportKind } from "@/server/imports/importFields";

/**
 * Smart import: the AI looks at the file's headers and a few sample rows and says which column
 * holds which of our fields. Only headers and at most 5 rows are sent. The person still sees and
 * can change every mapping before anything is imported.
 */
export type SmartMapResult = { status: "ok"; mapping: Record<string, number> } | { status: "no_key" } | { status: "ai_error"; message: string };

export async function smartMapColumns(input: { tenantId: string; kind: ImportKind; headers: string[]; sample: string[][] }): Promise<SmartMapResult> {
  const aiKey = await resolveAnyAiKey(input.tenantId);
  if (!aiKey) return { status: "no_key" };
  const fields = IMPORT_FIELDS[input.kind];
  const table = [input.headers, ...input.sample.slice(0, 5)]
    .map((r, i) => `${i === 0 ? "HEADERS" : `ROW ${i}`}: ${r.map((c, j) => `[${j}] ${c}`).join(" | ")}`)
    .join("\n");

  const system =
    "You map spreadsheet columns exported from Indian retail/billing software (Tally, Vyapar, Marg, Busy, Excel) to a target schema. " +
    "Use the headers AND the sample values. Map a column only when you are confident; leave a field out otherwise. Never map one column to two fields.";

  const prompt = `Target fields:\n${fields.map((f) => `- ${f.key}: ${f.label}${f.required ? " (required)" : ""}`).join("\n")}\n\nFile:\n${table}\n\nReturn JSON: { "matches": [{ "field": "string", "column": integer }] }`;

  try {
    let matches: { field: string; column: number }[] = [];

    if (aiKey.provider === "gemini") {
      const out = await callGeminiStructured<{ matches: { field: string; column: number }[] }>({
        apiKey: aiKey.apiKey,
        systemInstruction: system,
        parts: [{ text: prompt }],
      });
      matches = out.matches ?? [];
    } else if (aiKey.provider === "openai") {
      const out = await callOpenAiStructured<{ matches: { field: string; column: number }[] }>({
        apiKey: aiKey.apiKey,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      });
      matches = out.matches ?? [];
    } else {
      const out = await callClaudeTool<{ matches: { field: string; column: number }[] }>({
        apiKey: aiKey.apiKey,
        maxTokens: 1500,
        timeoutMs: 45_000,
        system,
        tool: {
          name: "map_columns",
          description: "Which column index holds each target field.",
          input_schema: {
            type: "object",
            properties: {
              matches: {
                type: "array",
                items: {
                  type: "object",
                  properties: { field: { type: "string", enum: fields.map((f) => f.key) }, column: { type: "integer" } },
                  required: ["field", "column"],
                },
              },
            },
            required: ["matches"],
          },
        },
        content: [{ type: "text", text: prompt }],
      });
      matches = out.matches ?? [];
    }

    const mapping: Record<string, number> = Object.fromEntries(fields.map((f) => [f.key, -1]));
    const used = new Set<number>();
    for (const m of matches) {
      if (m.field in mapping && Number.isInteger(m.column) && m.column >= 0 && m.column < input.headers.length && !used.has(m.column)) {
        mapping[m.field] = m.column;
        used.add(m.column);
      }
    }
    return { status: "ok", mapping };
  } catch (err) {
    if (err instanceof AiCallError || err instanceof GeminiCallError || err instanceof OpenAiCallError) return { status: "ai_error", message: err.message };
    throw err;
  }
}
