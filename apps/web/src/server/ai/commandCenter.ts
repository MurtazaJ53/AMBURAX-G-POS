import { resolveAnyAiKey } from "./aiKey";
import { callClaudeTool, AiCallError } from "./claude";
import { callGeminiStructured, GeminiCallError } from "./gemini";
import { callOpenAiStructured, OpenAiCallError } from "./openai";
import { gatherBusinessGrounding, type BusinessGrounding } from "./grounding";
import { formatMinor } from "@/server/sales/saleTotals";

export interface AiBriefing {
  headline: string;
  sentiment: "positive" | "attention" | "critical";
  executiveSummary: string;
  keyInsights: {
    title: string;
    description: string;
    urgency: "high" | "medium" | "low";
    category: "sales" | "inventory" | "khata";
  }[];
  suggestedActions: {
    id: string;
    title: string;
    actionType: "reorder" | "reminder" | "discount";
    target: string;
    previewText: string;
    level: "L1_SUGGEST" | "L2_DRAFT" | "L3_APPROVAL";
  }[];
}

const BRIEFING_TOOL = {
  name: "generate_store_briefing",
  description: "Generate structured, factual store executive intelligence and actions from grounded store metrics.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "Punchy, 1-line store status headline." },
      sentiment: { type: "string", enum: ["positive", "attention", "critical"] },
      executiveSummary: { type: "string", description: "2-3 sentences summarizing sales velocity, stock risks, and khata dues." },
      keyInsights: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            urgency: { type: "string", enum: ["high", "medium", "low"] },
            category: { type: "string", enum: ["sales", "inventory", "khata"] },
          },
          required: ["title", "description", "urgency", "category"],
        },
      },
      suggestedActions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            actionType: { type: "string", enum: ["reorder", "reminder", "discount"] },
            target: { type: "string" },
            previewText: { type: "string", description: "Drafted communication or action payload for review before execution." },
            level: { type: "string", enum: ["L1_SUGGEST", "L2_DRAFT", "L3_APPROVAL"] },
          },
          required: ["id", "title", "actionType", "target", "previewText", "level"],
        },
      },
    },
    required: ["headline", "sentiment", "executiveSummary", "keyInsights", "suggestedActions"],
  },
};

export async function generateAiStoreBrief(input: {
  tenantId: string;
  storeId: string;
}): Promise<
  | { status: "ok"; brief: AiBriefing; facts: BusinessGrounding }
  | { status: "no_key"; facts: BusinessGrounding }
  | { status: "ai_error"; message: string; facts: BusinessGrounding }
> {
  const facts = await gatherBusinessGrounding(input);
  const aiKey = await resolveAnyAiKey(input.tenantId);

  if (!aiKey) {
    return { status: "no_key", facts };
  }

  const prompt = `You are the executive retail intelligence copilot for "${facts.storeName}".
Analyze the following store data for trading day ${facts.tradingDay}:

- Today's Sales: ${formatMinor(facts.todaySales.totalMinor)} across ${facts.todaySales.billCount} bills (${facts.todaySales.itemsSold} pieces sold). Avg bill: ${facts.todaySales.avgBillMinor ? formatMinor(facts.todaySales.avgBillMinor) : "N/A"}.
- Yesterday's Sales: ${formatMinor(facts.yesterdaySales.totalMinor)} across ${facts.yesterdaySales.billCount} bills.
- Inventory Health: ${facts.inventoryAlerts.outOfStockCount} items out of stock, ${facts.inventoryAlerts.lowStockCount} items critically low. Critical items: ${facts.inventoryAlerts.criticalItems.map((i) => `${i.name} (Qty: ${i.qty})`).join(", ") || "None"}.
- Customer Credit (Khata): Total open credit ${formatMinor(facts.khataDueAlerts.totalOutstandingMinor)}, with ${facts.khataDueAlerts.overdueCount} overdue customer balances. Top overdue customers: ${facts.khataDueAlerts.topDebtors.map((d) => `${d.name} owes ${formatMinor(d.dueMinor)}, pending ${d.daysPending} days`).join("; ") || "None"}.

Rules:
1. Strict grounding: Never hallucinate numbers, names or items.
2. Provide high-value, actionable recommendations for retail owners.
3. Every high-risk external action (messaging customers, supplier PO draft) must be tagged L3_APPROVAL.
`;

  try {
    let brief: AiBriefing;

    if (aiKey.provider === "gemini") {
      brief = await callGeminiStructured<AiBriefing>({
        apiKey: aiKey.apiKey,
        systemInstruction: "You are AMBURAX Store Intelligence. Output only structured JSON matching the briefing format.",
        parts: [
          {
            text: `${prompt}\n\nFormat your response as JSON with fields: headline (string), sentiment ('positive'|'attention'|'critical'), executiveSummary (string), keyInsights (array of {title, description, urgency, category}), suggestedActions (array of {id, title, actionType, target, previewText, level}).`,
          },
        ],
      });
    } else if (aiKey.provider === "openai") {
      brief = await callOpenAiStructured<AiBriefing>({
        apiKey: aiKey.apiKey,
        messages: [
          {
            role: "system",
            content: "You are AMBURAX Store Intelligence. Output only structured JSON matching the briefing format.",
          },
          {
            role: "user",
            content: `${prompt}\n\nFormat your response as JSON with fields: headline (string), sentiment ('positive'|'attention'|'critical'), executiveSummary (string), keyInsights (array of {title, description, urgency, category}), suggestedActions (array of {id, title, actionType, target, previewText, level}).`,
          },
        ],
      });
    } else {
      brief = await callClaudeTool<AiBriefing>({
        apiKey: aiKey.apiKey,
        system: "You are AMBURAX Store Intelligence. Output only structured JSON matching the tool schema.",
        tool: BRIEFING_TOOL,
        content: [{ type: "text", text: prompt }],
        maxTokens: 3000,
        timeoutMs: 45000,
      });
    }

    return { status: "ok", brief, facts };
  } catch (err) {
    if (err instanceof AiCallError || err instanceof GeminiCallError || err instanceof OpenAiCallError) {
      return { status: "ai_error", message: err.message, facts };
    }
    return { status: "ai_error", message: "Failed to generate briefing.", facts };
  }
}
