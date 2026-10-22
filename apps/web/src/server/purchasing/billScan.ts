import { db } from "@/server/db";
import { resolveAnyAiKey } from "@/server/ai/aiKey";
import { AiCallError, callClaudeTool, type ClaudeContent } from "@/server/ai/claude";
import { callGeminiStructured, GeminiCallError } from "@/server/ai/gemini";
import { callOpenAiStructured, OpenAiCallError } from "@/server/ai/openai";
import { searchPurchaseItems, type PurchaseProductHit, type PurchaseVariantHit } from "@/server/purchasing/purchaseItems";

/**
 * Read a supplier's bill (photo or PDF, with or without GST) into a draft purchase.
 *
 * The AI only *reads*: supplier, invoice number and date, and each line. Matching to this shop's
 * suppliers and products happens here, in code, in this order:
 *   1. a learned alias (someone matched this supplier's line text before),
 *   2. an exact SKU or barcode,
 *   3. a product-name search narrowed by size/colour.
 * Nothing is saved. The person reviews the draft on New purchase and saves it themselves.
 */

export const BILL_MAX_BYTES = 8 * 1024 * 1024;
export const BILL_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

interface ReadLine {
  description: string;
  code?: string | null;
  hsn?: string | null;
  size?: string | null;
  colour?: string | null;
  quantity: number;
  unitCostExclGst?: number | null;
  gstRatePercent?: number | null;
}

interface ReadBill {
  supplierName?: string | null;
  supplierGstin?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  billHasGst: boolean;
  lines: ReadLine[];
  grandTotal?: number | null;
}

const TOOL = {
  name: "record_supplier_bill",
  description: "Record exactly what is printed or written on this supplier bill / invoice.",
  input_schema: {
    type: "object",
    properties: {
      supplierName: { type: ["string", "null"], description: "Seller's business name as printed." },
      supplierGstin: { type: ["string", "null"], description: "Seller's 15-character GSTIN, if printed." },
      invoiceNumber: { type: ["string", "null"] },
      invoiceDate: { type: ["string", "null"], description: "YYYY-MM-DD" },
      billHasGst: { type: "boolean", description: "True if GST (CGST/SGST/IGST) is charged on the bill." },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "Item name/description exactly as on the bill." },
            code: { type: ["string", "null"], description: "Item/style code, SKU or barcode if printed." },
            hsn: { type: ["string", "null"] },
            size: { type: ["string", "null"] },
            colour: { type: ["string", "null"] },
            quantity: { type: "integer", description: "Pieces received on this line." },
            unitCostExclGst: {
              type: ["number", "null"],
              description:
                "Cost of ONE piece in rupees EXCLUDING GST. If the bill shows a GST-inclusive rate, remove the GST. Null if not readable.",
            },
            gstRatePercent: { type: ["number", "null"], description: "GST % on this line (0 if none). Null if not shown." },
          },
          required: ["description", "quantity"],
        },
      },
      grandTotal: { type: ["number", "null"], description: "Invoice grand total in rupees." },
    },
    required: ["billHasGst", "lines"],
  },
};

const SYSTEM =
  "You read Indian retail supplier bills and wholesale invoices (garments and readymade apparel), printed or handwritten, in English or Indian regional scripts. " +
  "Record only what is on the bill. Never invent items, quantities, prices or GSTINs; use null when something is unreadable. " +
  "Garment Wholesaler Packing / Ratio rule: " +
  "If an invoice row lists a set, ratio, or multiple sizes (e.g. 'Cargo Pant 4-Way M-2, L-4, XL-2' or 'Set of S-XXL 5 pcs' or 'Box of 12 pcs: 28(2), 30(4), 32(4), 34(2)'), " +
  "SPLIT it into separate line items for each distinct size/colour with its specific piece count. " +
  "Ensure unitCostExclGst represents the wholesale cost of ONE individual piece.";

export interface DraftLine {
  billText: string;
  code: string | null;
  quantity: number;
  unitCostMinor: number | null;
  gstRateBp: number;
  /** "matched" = alias or exact code; "suggested" = name match to check; "none" = needs a person. */
  match: "matched" | "suggested" | "none";
  variant: PurchaseVariantHit | null;
  productName: string | null;
  /** For a "none" line, what to search for or name a new product. */
  searchHint: string;
}

export interface BillDraft {
  supplier: { id: string; name: string } | null;
  supplierRead: { name: string | null; gstin: string | null };
  invoiceNumber: string | null;
  invoiceDate: string | null;
  billHasGst: boolean;
  grandTotalMinor: number | null;
  lines: DraftLine[];
}

export type ScanResult = { status: "ok"; draft: BillDraft } | { status: "no_key" } | { status: "ai_error"; message: string };

export function normaliseBillText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
}

const toMinor = (rupees: number | null | undefined) =>
  typeof rupees === "number" && Number.isFinite(rupees) && rupees >= 0 ? Math.round(rupees * 100) : null;

function pickVariant(product: PurchaseProductHit, size: string | null | undefined, colour: string | null | undefined): PurchaseVariantHit | null {
  const eq = (a: string | null, b: string | null | undefined) => !b || (a ?? "").toLowerCase() === b.trim().toLowerCase();
  const exact = product.variants.filter((v) => eq(v.size, size) && eq(v.colour, colour));
  if (exact.length === 1) return exact[0]!;
  return product.variants.length === 1 ? product.variants[0]! : null;
}

/** Turn what the AI read into a draft matched against this shop's suppliers and products. */
export async function matchBill(input: { tenantId: string; storeId: string; read: ReadBill }): Promise<BillDraft> {
  const { read } = input;
  const gstin = read.supplierGstin?.trim().toUpperCase() || null;
  const supplierName = read.supplierName?.trim() || null;
  const supplier =
    (gstin && (await db.supplier.findFirst({ where: { tenantId: input.tenantId, gstin }, select: { id: true, name: true } }))) ||
    (supplierName &&
      (await db.supplier.findFirst({
        where: { tenantId: input.tenantId, name: { equals: supplierName, mode: "insensitive" } },
        select: { id: true, name: true },
      }))) ||
    null;

  const lines: DraftLine[] = [];
  for (const l of (read.lines ?? []).slice(0, 200)) {
    const quantity = Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : 0;
    if (!quantity || !l.description?.trim()) continue;
    const text = [l.description, l.size, l.colour].filter(Boolean).join(" ");
    const base: DraftLine = {
      billText: text,
      code: l.code?.trim() || null,
      quantity,
      unitCostMinor: toMinor(l.unitCostExclGst),
      gstRateBp: read.billHasGst ? Math.round((l.gstRatePercent ?? 0) * 100) : 0,
      match: "none",
      variant: null,
      productName: null,
      searchHint: l.description.trim(),
    };

    // 1. Learned alias for this supplier.
    if (supplier) {
      const alias = await db.supplierItemAlias.findUnique({
        where: { tenantId_supplierId_text: { tenantId: input.tenantId, supplierId: supplier.id, text: normaliseBillText(text) } },
        select: { variantId: true },
      });
      if (alias) {
        const v = await db.productVariant.findFirst({ where: { id: alias.variantId, tenantId: input.tenantId }, select: { sku: true } });
        const hits = v ? await searchPurchaseItems({ tenantId: input.tenantId, storeId: input.storeId, q: v.sku }) : [];
        const found = hits.flatMap((p) => p.variants.map((x) => ({ p, x }))).find(({ x }) => x.variantId === alias.variantId);
        if (found) {
          lines.push({ ...base, match: "matched", variant: found.x, productName: found.p.name });
          continue;
        }
      }
    }
    // 2. Exact code (SKU or barcode).
    if (base.code) {
      const hits = await searchPurchaseItems({ tenantId: input.tenantId, storeId: input.storeId, q: base.code });
      const exact = hits.flatMap((p) => p.variants.map((v) => ({ p, v }))).filter(({ v }) => v.sku.toLowerCase() === base.code!.toLowerCase());
      if (exact.length === 1) {
        lines.push({ ...base, match: "matched", variant: exact[0]!.v, productName: exact[0]!.p.name });
        continue;
      }
    }
    // 3. Name search narrowed by size/colour — a suggestion the person confirms.
    const byName = await searchPurchaseItems({ tenantId: input.tenantId, storeId: input.storeId, q: l.description.trim().slice(0, 40) });
    if (byName.length === 1) {
      const variant = pickVariant(byName[0]!, l.size, l.colour);
      if (variant) {
        lines.push({ ...base, match: "suggested", variant, productName: byName[0]!.name });
        continue;
      }
    }
    lines.push(base);
  }

  return {
    supplier,
    supplierRead: { name: supplierName, gstin },
    invoiceNumber: read.invoiceNumber?.trim() || null,
    invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(read.invoiceDate ?? "") ? read.invoiceDate! : null,
    billHasGst: Boolean(read.billHasGst),
    grandTotalMinor: toMinor(read.grandTotal),
    lines,
  };
}

export async function scanSupplierBill(input: {
  tenantId: string;
  storeId: string;
  file: { base64: string; mediaType: (typeof BILL_TYPES)[number] };
}): Promise<ScanResult> {
  const aiKey = await resolveAnyAiKey(input.tenantId);
  if (!aiKey) return { status: "no_key" };

  let read: ReadBill;

  if (aiKey.provider === "gemini") {
    try {
      const prompt = `${SYSTEM}\n\nRead this supplier invoice/bill image or document and return the JSON according to the specified structure.`;
      const part = {
        inlineData: {
          mimeType: input.file.mediaType,
          data: input.file.base64,
        },
      };

      read = await callGeminiStructured<ReadBill>({
        apiKey: aiKey.apiKey,
        systemInstruction: SYSTEM,
        parts: [{ text: prompt }, part],
      });
    } catch (err) {
      if (err instanceof GeminiCallError) return { status: "ai_error", message: err.message };
      throw err;
    }
  } else if (aiKey.provider === "openai") {
    try {
      const dataUrl = `data:${input.file.mediaType};base64,${input.file.base64}`;
      const prompt = `${SYSTEM}\n\nRead this supplier invoice/bill and return JSON strictly according to the format:\n{\n  "supplierName": string | null,\n  "supplierGstin": string | null,\n  "invoiceNumber": string | null,\n  "invoiceDate": "YYYY-MM-DD" | null,\n  "billHasGst": boolean,\n  "lines": [{ "description": string, "code": string | null, "hsn": string | null, "size": string | null, "colour": string | null, "quantity": integer, "unitCostExclGst": number | null, "gstRatePercent": number | null }],\n  "grandTotal": number | null\n}`;

      read = await callOpenAiStructured<ReadBill>({
        apiKey: aiKey.apiKey,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
      });
    } catch (err) {
      if (err instanceof OpenAiCallError) return { status: "ai_error", message: err.message };
      throw err;
    }
  } else {
    const doc: ClaudeContent =
      input.file.mediaType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.file.base64 } }
        : { type: "image", source: { type: "base64", media_type: input.file.mediaType, data: input.file.base64 } };

    try {
      read = await callClaudeTool<ReadBill>({
        apiKey: aiKey.apiKey,
        system: SYSTEM,
        tool: TOOL,
        content: [doc, { type: "text", text: "Read this supplier bill." }],
      });
    } catch (err) {
      if (err instanceof AiCallError) return { status: "ai_error", message: err.message };
      throw err;
    }
  }

  return { status: "ok", draft: await matchBill({ tenantId: input.tenantId, storeId: input.storeId, read }) };
}

/** Remember that this supplier's bill text means this variant (when a person matches a line). */
export async function learnSupplierAlias(input: { tenantId: string; supplierId: string; billText: string; variantId: string }) {
  const text = normaliseBillText(input.billText);
  if (!text) return;
  const [supplier, variant] = await Promise.all([
    db.supplier.findFirst({ where: { id: input.supplierId, tenantId: input.tenantId }, select: { id: true } }),
    db.productVariant.findFirst({ where: { id: input.variantId, tenantId: input.tenantId }, select: { id: true } }),
  ]);
  if (!supplier || !variant) return;
  await db.supplierItemAlias.upsert({
    where: { tenantId_supplierId_text: { tenantId: input.tenantId, supplierId: input.supplierId, text } },
    create: { tenantId: input.tenantId, supplierId: input.supplierId, text, variantId: input.variantId },
    update: { variantId: input.variantId },
  });
}
