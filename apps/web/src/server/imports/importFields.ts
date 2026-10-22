/**
 * What each import understands. Safe for the browser (no server imports): the import screen uses
 * it to auto-match the columns of a file from another software, and to build templates.
 */

export const IMPORT_KINDS = ["customers", "products", "sales"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  /** Header names other software uses for this column (lower-case, matched loosely). */
  aliases: string[];
  example: string;
}

export const IMPORT_FIELDS: Record<ImportKind, ImportField[]> = {
  customers: [
    { key: "name", label: "Name", required: true, aliases: ["name", "customer", "customer name", "party", "party name", "client"], example: "Asha Rao" },
    { key: "phone", label: "Mobile", aliases: ["phone", "mobile", "mobile no", "mobile number", "contact", "contact no", "whatsapp", "phone number"], example: "9876543210" },
    { key: "email", label: "Email", aliases: ["email", "e-mail", "mail", "email id"], example: "asha@example.com" },
    { key: "gstin", label: "GSTIN", aliases: ["gstin", "gst", "gst no", "gst number", "gstin/uin"], example: "" },
  ],
  products: [
    { key: "name", label: "Product name", required: true, aliases: ["name", "product", "product name", "item", "item name", "description", "article"], example: "Cotton Kurta" },
    { key: "sku", label: "SKU / item code", aliases: ["sku", "code", "item code", "product code", "style", "style no", "article no"], example: "KUR-M-BLU" },
    { key: "barcode", label: "Barcode", aliases: ["barcode", "ean", "upc", "bar code"], example: "8901234567890" },
    { key: "size", label: "Size", aliases: ["size"], example: "M" },
    { key: "colour", label: "Colour", aliases: ["colour", "color", "shade"], example: "Blue" },
    { key: "brand", label: "Brand", aliases: ["brand", "company", "make"], example: "" },
    { key: "category", label: "Category", aliases: ["category", "group", "item group", "department"], example: "Kurtas" },
    { key: "price", label: "Selling price (incl. GST)", required: true, aliases: ["price", "selling price", "sale price", "rate", "sp", "mrp price", "retail price"], example: "999" },
    { key: "mrp", label: "MRP", aliases: ["mrp", "max retail price"], example: "1299" },
    { key: "gstType", label: "GST type", aliases: ["gst type", "tax type", "taxability", "tax category"], example: "taxable" },
    { key: "gstRate", label: "GST %", aliases: ["gst %", "gst rate", "tax %", "tax rate", "gst", "igst %"], example: "5" },
    { key: "cost", label: "Cost (excl. GST)", aliases: ["cost", "purchase price", "cost price", "pp", "purchase rate"], example: "550" },
    { key: "stock", label: "Opening stock", aliases: ["stock", "qty", "quantity", "closing stock", "opening stock", "balance", "current stock", "in stock"], example: "12" },
  ],
  sales: [
    { key: "billNumber", label: "Bill number", required: true, aliases: ["bill no", "bill number", "invoice no", "invoice number", "voucher no", "bill", "invoice"], example: "INV-1023" },
    { key: "date", label: "Date", required: true, aliases: ["date", "bill date", "invoice date", "voucher date"], example: "2025-03-31" },
    { key: "total", label: "Bill total", required: true, aliases: ["total", "amount", "bill amount", "grand total", "net amount", "invoice amount"], example: "2499" },
    { key: "tax", label: "GST in bill", aliases: ["tax", "gst", "tax amount", "gst amount", "total tax"], example: "119" },
    { key: "customerName", label: "Customer name", aliases: ["customer", "customer name", "party", "party name", "name"], example: "Asha Rao" },
    { key: "customerPhone", label: "Customer mobile", aliases: ["mobile", "phone", "customer mobile", "contact"], example: "9876543210" },
    { key: "paymentMode", label: "Payment mode", aliases: ["payment", "payment mode", "mode", "paid by"], example: "Cash" },
    { key: "items", label: "Items", aliases: ["items", "products", "item details", "particulars"], example: "Kurta M x2" },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

/** Match file headers to fields by name. Returns header index per field key (or -1). */
export function autoMapColumns(kind: ImportKind, headers: string[]): Record<string, number> {
  const fields = IMPORT_FIELDS[kind];
  const map: Record<string, number> = {};
  const used = new Set<number>();
  const h = headers.map(norm);
  for (const f of fields) {
    let idx = h.findIndex((x, i) => !used.has(i) && (x === norm(f.label) || f.aliases.includes(x)));
    if (idx < 0) idx = h.findIndex((x, i) => !used.has(i) && f.aliases.some((a) => a.length > 3 && x.includes(a)));
    map[f.key] = idx;
    if (idx >= 0) used.add(idx);
  }
  return map;
}
