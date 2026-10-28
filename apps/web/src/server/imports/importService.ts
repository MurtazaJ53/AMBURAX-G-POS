import { randomUUID } from "node:crypto";
import { GstTaxTreatment, type TaxRateMode } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { createCustomer } from "@/server/sales/customers";
import { createProduct, createVariant } from "@/server/catalog/catalogService";
import { receiveStock } from "@/server/inventory/inventoryService";
import type { ImportKind } from "@/server/imports/importFields";

/**
 * Moving in from another software (owner only).
 *
 * - **Customers** are added; one with a mobile already on file is left as it is (counted "already here").
 * - **Products & stock** are grouped by product name into products with size/colour variants; an
 *   SKU that already exists is skipped, so re-running a file never doubles anything. Opening stock
 *   is received through the stock ledger with its cost, keyed per batch + SKU.
 *   GST is taken only from the file: a GST % makes it taxable at that rate; "nil" / "non-gst" /
 *   "zero" / "slab" are honoured; nothing given means "needs a GST type" (never guessed) for a
 *   GST-registered shop, and non-GST for a shop without a GSTIN (it can't charge GST).
 * - **Past sales** are kept as history (ImportedSale): they show in customer history and totals,
 *   but move no stock, post nothing and never go to ERPNext. A bill number already imported is skipped.
 *
 * Rows arrive already mapped to field keys, in batches of at most 500. Every row gets a result.
 */

export type ImportRow = Record<string, string | undefined>;
export interface RowError {
  row: number;
  reason: string;
}
export interface ImportOutcome {
  created: number;
  skipped: number;
  errors: RowError[];
}

type Actor = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };

export const MAX_IMPORT_ROWS = 500;

function money(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

function wholeNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw.replace(/[,\s]/g, ""));
  return Number.isInteger(n) ? n : NaN;
}

/** YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY or DD.MM.YYYY (Indian order), at noon IST. */
export function parseBillDate(raw: string | undefined): Date | null {
  const s = raw?.trim() ?? "";
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) {
    [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
    if (y < 100) y += 2000;
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d, 6, 30));
  return date.getUTCDate() === d ? date : null;
}

export function gstFrom(
  row: ImportRow,
): { treatment: GstTaxTreatment; rateMode: TaxRateMode; rateBp: number; exemptionRef?: string } | string {
  const type = (row.gstType ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const rate = row.gstRate?.trim() ? Number(row.gstRate.replace("%", "")) : null;
  if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 40)) return "GST % should be a number like 5 or 18.";
  if (type.includes("exempt")) {
    const exemptionRef = row.exemptionRef?.trim();
    if (!exemptionRef) {
      return "Exempt items need their exemption notification. Add it in an \"Exemption reference\" column (like \"Notification 2/2017-CT(R) Sl. 1\") and import this row again.";
    }
    if (rate !== null && rate > 0) return "An exempt item can't have a GST %. Leave GST % empty for this row.";
    return { treatment: "EXEMPT", rateMode: "FIXED", rateBp: 0, exemptionRef };
  }
  if (type.includes("nil")) return { treatment: "NIL_RATED", rateMode: "FIXED", rateBp: 0 };
  if (type.includes("nongst") || type === "none") return { treatment: "NON_GST", rateMode: "FIXED", rateBp: 0 };
  if (type.includes("zero")) return { treatment: "ZERO_RATED", rateMode: "FIXED", rateBp: 0 };
  if (type.includes("slab")) return { treatment: "TAXABLE", rateMode: "APPAREL_SLAB", rateBp: 0 };
  if (rate !== null && rate > 0) return { treatment: "TAXABLE", rateMode: "FIXED", rateBp: Math.round(rate * 100) };
  return { treatment: "UNSPECIFIED", rateMode: "FIXED", rateBp: 0 };
}

/** The owner reads these: every refusal is a sentence, never an internal status code. */
function refusalReason(res: { status: string; message?: string }): string {
  switch (res.status) {
    case "conflict":
    case "duplicate_sku":
    case "duplicate_barcode":
      return "That SKU or barcode is already used.";
    case "duplicate_product_name":
      return "A product with this name already exists.";
    case "invalid_tax_classification":
      return "The GST details for this row don't fit this business. Check the GST type and GST %.";
    case "price_exceeds_mrp":
      return "Selling price is higher than the MRP.";
    case "price_below_minimum":
      return "Selling price is below the minimum price.";
    case "forbidden":
      return "You aren't allowed to add products.";
    case "not_found":
      return "The product this row belongs to couldn't be found.";
    default:
      return res.message ?? "This row couldn't be added. Check it and try again.";
  }
}

function skuPart(text: string, max: number): string {
  return text.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "").toUpperCase().slice(0, max);
}

async function importCustomers(actor: Actor, rows: ImportRow[], first: number): Promise<ImportOutcome> {
  const out: ImportOutcome = { created: 0, skipped: 0, errors: [] };
  for (const [i, row] of rows.entries()) {
    const res = await createCustomer({
      tenantId: actor.tenantId,
      name: row.name ?? "",
      phone: row.phone || null,
      email: row.email || null,
      gstin: row.gstin || null,
      actorUserId: actor.userId,
    });
    if (res.status === "ok") {
      if (res.existing) out.skipped++;
      else out.created++;
    } else {
      out.errors.push({ row: first + i, reason: res.status === "validation_error" ? `${res.field}: ${res.error}` : "Name isn't valid." });
    }
  }
  return out;
}

async function importProducts(actor: Actor, storeId: string, batchId: string, rows: ImportRow[], first: number): Promise<ImportOutcome> {
  const out: ImportOutcome = { created: 0, skipped: 0, errors: [] };
  const uom =
    (await db.uom.findFirst({ where: { tenantId: actor.tenantId, isActive: true, code: { in: ["PCS", "NOS", "Nos", "PC"] } }, select: { id: true } })) ??
    (await db.uom.findFirst({ where: { tenantId: actor.tenantId, isActive: true }, orderBy: { code: "asc" }, select: { id: true } }));
  if (!uom) {
    out.errors.push({ row: first, reason: "Set up a unit (like PCS) before importing products." });
    return out;
  }
  // A shop without a GSTIN can't charge GST: its rows are non-GST unless the file says
  // otherwise, and a GST % in the file is refused with the reason. A GST shop's rows still
  // must say their GST; it is never guessed.
  const tenant = await db.tenant.findUnique({ where: { id: actor.tenantId }, select: { taxId: true } });
  const isGstShop = Boolean(tenant?.taxId?.trim());
  const productIdByName = new Map<string, string>();
  for (const [i, row] of rows.entries()) {
    const n = first + i;
    const name = row.name?.trim();
    const price = money(row.price);
    const cost = money(row.cost);
    const stock = wholeNumber(row.stock);
    const gst = gstFrom(row);
    if (!name) {
      out.errors.push({ row: n, reason: "Product name is empty." });
      continue;
    }
    if (price === null || Number.isNaN(price) || price <= 0) {
      out.errors.push({ row: n, reason: "Selling price is missing or not a number." });
      continue;
    }
    if (Number.isNaN(cost) || Number.isNaN(stock) || (stock !== null && stock < 0)) {
      out.errors.push({ row: n, reason: "Cost or opening stock isn't a valid number." });
      continue;
    }
    if (typeof gst === "string") {
      out.errors.push({ row: n, reason: gst });
      continue;
    }
    if (!isGstShop && gst.treatment === "UNSPECIFIED") {
      gst.treatment = "NON_GST";
    }
    if (!isGstShop && (gst.treatment === "TAXABLE" || gst.rateBp > 0)) {
      out.errors.push({
        row: n,
        reason: "This business has no GSTIN, so it can't charge GST. Remove the GST % (or add your GSTIN in Settings → Company first).",
      });
      continue;
    }
    if (gst.treatment === "UNSPECIFIED") {
      out.errors.push({ row: n, reason: "Give this row a GST % (like 5) or a GST type (non-GST, nil, zero or slab)." });
      continue;
    }
    const size = row.size?.trim() || null;
    const colour = row.colour?.trim() || null;
    const sku =
      row.sku?.trim() ||
      [skuPart(name, 10) || "ITEM", size ? skuPart(size, 6) : null, colour ? skuPart(colour, 6) : null, batchId.slice(0, 4).toUpperCase()]
        .filter(Boolean)
        .join("-");
    const existing = await db.productVariant.findFirst({ where: { tenantId: actor.tenantId, sku }, select: { id: true } });
    if (existing) {
      out.skipped++;
      continue;
    }
    const tax = { taxTreatment: gst.treatment, taxRateMode: gst.rateMode, taxRateBp: gst.rateBp, taxExemptionRef: gst.exemptionRef ?? null };
    const mrp = money(row.mrp);
    const mrpMinor = mrp !== null && !Number.isNaN(mrp) ? mrp : null;
    const key = name.toLowerCase();
    let productId = productIdByName.get(key);
    if (!productId) {
      productId = (await db.product.findFirst({ where: { tenantId: actor.tenantId, name: { equals: name, mode: "insensitive" } }, select: { id: true } }))?.id;
    }
    let variantId: string;
    const correlationId = randomUUID();
    if (productId) {
      const v = await createVariant({
        actor,
        productId,
        sku,
        barcode: row.barcode?.trim() || null,
        size,
        colour,
        priceMinor: price,
        mrpMinor,
        isActive: true,
        correlationId,
        ...tax,
      });
      if (v.status !== "ok") {
        out.errors.push({ row: n, reason: refusalReason(v) });
        continue;
      }
      variantId = v.variantId;
    } else {
      const p = await createProduct({
        actor,
        name,
        category: row.category?.trim() || null,
        brand: row.brand?.trim() || null,
        imageUrl: null,
        isActive: true,
        baseUomId: uom.id,
        correlationId,
        firstVariant: { sku, barcode: row.barcode?.trim() || null, size, colour, priceMinor: price, mrpMinor, isActive: true, ...tax },
      });
      if (p.status !== "ok") {
        out.errors.push({ row: n, reason: refusalReason(p) });
        continue;
      }
      productId = p.productId;
      variantId = p.variantId;
    }
    productIdByName.set(key, productId);
    if (stock && stock > 0) {
      const r = await receiveStock({
        actor,
        storeId,
        variantId,
        quantity: stock,
        reason: "Opening stock (imported)",
        requestKey: `import:${batchId}:${sku}`,
        correlationId,
        unitCostMinor: cost ?? null,
      });
      if (r.status !== "ok") out.errors.push({ row: n, reason: "Product added, but its opening stock couldn't be recorded." });
    }
    out.created++;
  }
  return out;
}

async function importSales(actor: Actor, storeId: string, batchId: string, rows: ImportRow[], first: number): Promise<ImportOutcome> {
  const out: ImportOutcome = { created: 0, skipped: 0, errors: [] };
  for (const [i, row] of rows.entries()) {
    const n = first + i;
    const billNumber = row.billNumber?.trim();
    const soldAt = parseBillDate(row.date);
    const total = money(row.total);
    const tax = money(row.tax);
    if (!billNumber) {
      out.errors.push({ row: n, reason: "Bill number is empty." });
      continue;
    }
    if (!soldAt) {
      out.errors.push({ row: n, reason: "Date isn't readable (use 31-03-2025 or 2025-03-31)." });
      continue;
    }
    if (total === null || Number.isNaN(total)) {
      out.errors.push({ row: n, reason: "Bill total is missing or not a number." });
      continue;
    }
    let customerId: string | null = null;
    const customerName = row.customerName?.trim() || null;
    const customerPhone = row.customerPhone?.trim() || null;
    if (customerName && customerPhone) {
      const c = await createCustomer({ tenantId: actor.tenantId, name: customerName, phone: customerPhone, actorUserId: actor.userId });
      if (c.status === "ok") customerId = c.customer.id;
    }
    const already = await db.importedSale.findUnique({
      where: { tenantId_storeId_billNumber: { tenantId: actor.tenantId, storeId, billNumber: billNumber.slice(0, 80) } },
      select: { id: true },
    });
    if (already) {
      out.skipped++;
      continue;
    }
    await db.importedSale.create({
      data: {
        tenantId: actor.tenantId,
        storeId,
        billNumber: billNumber.slice(0, 80),
        soldAt,
        customerId,
        customerName,
        customerPhone,
        totalMinor: total,
        taxMinor: tax !== null && !Number.isNaN(tax) ? tax : 0,
        paymentMode: row.paymentMode?.trim().slice(0, 40) || null,
        itemsText: row.items?.trim().slice(0, 2000) || null,
        importBatchId: batchId,
      },
    });
    out.created++;
  }
  return out;
}

export type RunImportResult = { status: "ok"; outcome: ImportOutcome } | { status: "forbidden" } | { status: "invalid"; reason: string };

export async function runImport(input: {
  actor: Actor;
  storeId: string;
  kind: ImportKind;
  batchId: string;
  firstRowNumber: number;
  rows: ImportRow[];
}): Promise<RunImportResult> {
  if (input.actor.tenantRole !== "OWNER") return { status: "forbidden" };
  if (input.rows.length === 0 || input.rows.length > MAX_IMPORT_ROWS) {
    return { status: "invalid", reason: `Send between 1 and ${MAX_IMPORT_ROWS} rows at a time.` };
  }
  const outcome =
    input.kind === "customers"
      ? await importCustomers(input.actor, input.rows, input.firstRowNumber)
      : input.kind === "products"
        ? await importProducts(input.actor, input.storeId, input.batchId, input.rows, input.firstRowNumber)
        : await importSales(input.actor, input.storeId, input.batchId, input.rows, input.firstRowNumber);
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: `import.${input.kind}`,
    correlationId: randomUUID(),
    metadata: { batchId: input.batchId, rows: input.rows.length, created: outcome.created, skipped: outcome.skipped, errors: outcome.errors.length },
  });
  return { status: "ok", outcome };
}
