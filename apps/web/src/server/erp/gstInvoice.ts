/**
 * GST on ERPNext Sales Invoices (owner 2026-10-16).
 *
 * AMBURAX prices are GST-inclusive and each sale line already stores the GST it contains
 * (`taxMinor`, after its share of any bill discount). For a GST-registered business the invoice
 * therefore goes to ERPNext as:
 *
 * - every line at its **taxable value** (what the customer paid for it, less the GST inside it),
 *   split into two rows when that value doesn't divide evenly by the quantity, so ERPNext's
 *   `qty × rate` adds up to the exact paise;
 * - **Actual** tax rows carrying the exact GST AMBURAX computed: CGST + SGST for a sale inside
 *   the business's state, IGST when a business customer's GSTIN is from another state.
 *
 * Grand total = Σ taxable + Σ GST = what the customer paid, to the paisa, so the payments settle
 * it with nothing written off. A business with no GSTIN gets no tax rows at all.
 *
 * Pure: no database, no network. The adapter supplies the facts and posts the result.
 */

export interface GstInvoiceLine {
  variantId: string;
  quantity: number;
  unitPriceMinor: number;
  lineDiscountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
}

export interface GstInvoiceItem {
  item_code: string;
  qty: number;
  rate: number;
}

export interface GstTaxRow {
  charge_type: "Actual";
  account_head: string;
  description: string;
  tax_amount: number;
}

export interface GstAccounts {
  cgst: string;
  sgst: string;
  igst: string;
}

/** ERPNext's standard Indian output tax accounts for a company abbreviation. */
export function defaultGstAccounts(abbr: string): GstAccounts {
  return { cgst: `Output Tax CGST - ${abbr}`, sgst: `Output Tax SGST - ${abbr}`, igst: `Output Tax IGST - ${abbr}` };
}

/**
 * Inter-state when the place of supply is in a different state than ours. For goods delivered to
 * the buyer that is the delivery state; otherwise only a business customer's GSTIN from another
 * state makes it inter-state.
 */
export function isInterState(
  supplierGstin: string,
  customerGstin: string | null | undefined,
  deliveryStateCode?: string | null,
): boolean {
  const theirs = deliveryStateCode?.trim() || customerGstin?.trim().slice(0, 2);
  return Boolean(theirs && /^\d{2}$/.test(theirs) && theirs !== supplierGstin.trim().slice(0, 2));
}

export function buildGstInvoice(input: {
  lines: GstInvoiceLine[];
  supplierGstin: string;
  customerGstin?: string | null;
  /** Two-digit GST state code of the delivery address, for goods delivered to the buyer. */
  deliveryStateCode?: string | null;
  accounts: GstAccounts;
}): { items: GstInvoiceItem[]; taxes: GstTaxRow[]; taxableMinor: number; taxMinor: number } {
  const items: GstInvoiceItem[] = [];
  let taxableMinor = 0;
  let taxMinor = 0;
  for (const line of input.lines) {
    const paid = line.lineTotalMinor - line.lineDiscountMinor;
    const taxable = paid - line.taxMinor;
    taxableMinor += taxable;
    taxMinor += line.taxMinor;
    const base = Math.floor(taxable / line.quantity);
    const extra = taxable - base * line.quantity; // 0 ≤ extra < quantity: units that carry one more paisa
    if (extra > 0) items.push({ item_code: line.variantId, qty: extra, rate: (base + 1) / 100 });
    if (line.quantity - extra > 0) items.push({ item_code: line.variantId, qty: line.quantity - extra, rate: base / 100 });
  }

  const taxes: GstTaxRow[] = [];
  if (taxMinor > 0) {
    if (isInterState(input.supplierGstin, input.customerGstin, input.deliveryStateCode)) {
      taxes.push({ charge_type: "Actual", account_head: input.accounts.igst, description: "IGST", tax_amount: taxMinor / 100 });
    } else {
      const cgst = Math.floor(taxMinor / 2);
      taxes.push({ charge_type: "Actual", account_head: input.accounts.cgst, description: "CGST", tax_amount: cgst / 100 });
      taxes.push({ charge_type: "Actual", account_head: input.accounts.sgst, description: "SGST", tax_amount: (taxMinor - cgst) / 100 });
    }
  }
  return { items, taxes, taxableMinor, taxMinor };
}
