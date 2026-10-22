/**
 * Sales CSV, built as a pure function so its escaping can be tested exactly.
 *
 * Columns are fixed by product decision: no customer name, phone, or internal ids. Amounts are the
 * stored integer minor units printed as decimal rupees, unchanged — the export never recomputes
 * totals, tax or discounts.
 */

export interface SalesCsvRow {
  billNumber: string;
  completedAt: Date;
  /** "CASH", "UPI", "CARD", or several joined with " + " for a split tender; null if none. */
  paymentMethod: string | null;
  status: string;
  subtotalMinor: number;
  taxMinor: number;
  discountMinor: number;
  totalMinor: number;
  paidMinor: number;
}

export const SALES_CSV_HEADERS = [
  "Bill Number",
  "Date/Time (IST)",
  "Payment Method",
  "Status",
  "Subtotal",
  "Tax",
  "Discount",
  "Total",
  "Paid",
] as const;

/** UTF-8 byte-order mark, so spreadsheet apps open the file as UTF-8. */
export const UTF8_BOM = "﻿";

/** Integer minor units as a plain decimal ("1234.50", "-5.00"); no currency symbol or grouping. */
export function minorToDecimal(minor: number): string {
  if (!Number.isSafeInteger(minor)) throw new Error(`Amount is not a safe integer: ${minor}`);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "YYYY-MM-DD HH:mm:ss" in IST (UTC+05:30, no daylight saving). */
export function istDateTime(value: Date): string {
  const ist = new Date(value.getTime() + 5.5 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())} ${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}`;
}

const FORMULA_LEADS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * One text cell. A value a spreadsheet could run as a formula (leading = + - @ tab or CR) is
 * prefixed with an apostrophe; then the cell is quoted if it holds a comma, quote, CR or LF, with
 * inner quotes doubled.
 */
export function csvTextCell(value: string): string {
  const safe = value.length > 0 && FORMULA_LEADS.has(value[0]!) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toSalesCsv(rows: SalesCsvRow[]): string {
  const lines = [SALES_CSV_HEADERS.map(csvTextCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvTextCell(r.billNumber),
        csvTextCell(istDateTime(r.completedAt)),
        csvTextCell(r.paymentMethod ?? ""),
        csvTextCell(r.status),
        // Amounts are generated here from integers (/^-?\d+\.\d{2}$/), so they cannot carry a
        // formula and stay unprefixed to remain numbers in a spreadsheet.
        minorToDecimal(r.subtotalMinor),
        minorToDecimal(r.taxMinor),
        minorToDecimal(r.discountMinor),
        minorToDecimal(r.totalMinor),
        minorToDecimal(r.paidMinor),
      ].join(","),
    );
  }
  return UTF8_BOM + lines.join("\r\n") + "\r\n";
}
