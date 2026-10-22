/**
 * GSTR-2B Purchase Matching Engine
 * Reconciles internal Purchase Register (Books) against Supplier-filed GSTR-2B data
 * to flag missing ITC, mismatches in Taxable Value / GST amounts, and mismatched dates.
 */

export interface PurchaseBookEntry {
  id: string;
  supplierGstin: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  totalTax: number;
}

export interface Gstr2bPortalEntry {
  supplierGstin: string;
  tradeName?: string;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  invoiceType: "B2B" | "CDNR" | "B2BA";
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  itcAvailable: boolean; // False if 16(4) time-barred or supplier non-filing
  itcIneligibleReason?: string;
}

export type MatchStatus =
  | "exact_match"
  | "value_mismatch"
  | "missing_in_portal"
  | "missing_in_books"
  | "itc_ineligible";

export interface ReconciledRecord {
  matchStatus: MatchStatus;
  supplierGstin: string;
  invoiceNumber: string;
  bookEntry?: PurchaseBookEntry;
  portalEntry?: Gstr2bPortalEntry;
  discrepancy: {
    taxableDiff: number;
    taxDiff: number;
    notes: string[];
  };
}

export interface Gstr2bReconcileResult {
  reconciledRecords: ReconciledRecord[];
  summary: {
    totalBookInvoices: number;
    totalPortalInvoices: number;
    exactMatchCount: number;
    mismatchCount: number;
    missingInPortalCount: number;
    missingInBooksCount: number;
    itcEligibleClaimAmount: number;
    itcAtRiskAmount: number;
  };
}

const TOLERANCE_RUPEES = 2.0; // Allowed rounding difference under GST guidelines

export function reconcileGstr2b(
  books: PurchaseBookEntry[],
  portal: Gstr2bPortalEntry[]
): Gstr2bReconcileResult {
  const portalMap = new Map<string, Gstr2bPortalEntry>();
  const matchedPortalKeys = new Set<string>();

  for (const p of portal) {
    const key = `${p.supplierGstin.trim().toUpperCase()}_${p.invoiceNumber.trim().toUpperCase()}`;
    portalMap.set(key, p);
  }

  const reconciledRecords: ReconciledRecord[] = [];
  let exactMatchCount = 0;
  let mismatchCount = 0;
  let missingInPortalCount = 0;
  let itcEligibleClaimAmount = 0;
  let itcAtRiskAmount = 0;

  for (const b of books) {
    const key = `${b.supplierGstin.trim().toUpperCase()}_${b.invoiceNumber.trim().toUpperCase()}`;
    const p = portalMap.get(key);

    if (!p) {
      // Missing in GSTR-2B! Buyer cannot claim ITC or risks notice
      missingInPortalCount++;
      itcAtRiskAmount += b.totalTax;
      reconciledRecords.push({
        matchStatus: "missing_in_portal",
        supplierGstin: b.supplierGstin,
        invoiceNumber: b.invoiceNumber,
        bookEntry: b,
        discrepancy: {
          taxableDiff: b.taxableValue,
          taxDiff: b.totalTax,
          notes: ["Invoice missing from GSTR-2B. Contact supplier to file GSTR-1."],
        },
      });
      continue;
    }

    matchedPortalKeys.add(key);

    if (!p.itcAvailable) {
      mismatchCount++;
      itcAtRiskAmount += b.totalTax;
      reconciledRecords.push({
        matchStatus: "itc_ineligible",
        supplierGstin: b.supplierGstin,
        invoiceNumber: b.invoiceNumber,
        bookEntry: b,
        portalEntry: p,
        discrepancy: {
          taxableDiff: 0,
          taxDiff: b.totalTax,
          notes: [
            p.itcIneligibleReason ||
              "ITC flagged as ineligible by GST portal / time-barred under Sec 16(4)",
          ],
        },
      });
      continue;
    }

    const portalTotalTax = p.igst + p.cgst + p.sgst;
    const taxableDiff = Math.abs(b.taxableValue - p.taxableValue);
    const taxDiff = Math.abs(b.totalTax - portalTotalTax);

    if (taxableDiff <= TOLERANCE_RUPEES && taxDiff <= TOLERANCE_RUPEES) {
      exactMatchCount++;
      itcEligibleClaimAmount += portalTotalTax;
      reconciledRecords.push({
        matchStatus: "exact_match",
        supplierGstin: b.supplierGstin,
        invoiceNumber: b.invoiceNumber,
        bookEntry: b,
        portalEntry: p,
        discrepancy: {
          taxableDiff: Math.round((b.taxableValue - p.taxableValue) * 100) / 100,
          taxDiff: Math.round((b.totalTax - portalTotalTax) * 100) / 100,
          notes: ["Matches perfectly with portal data"],
        },
      });
    } else {
      mismatchCount++;
      itcAtRiskAmount += Math.abs(b.totalTax - portalTotalTax);
      itcEligibleClaimAmount += Math.min(b.totalTax, portalTotalTax);
      reconciledRecords.push({
        matchStatus: "value_mismatch",
        supplierGstin: b.supplierGstin,
        invoiceNumber: b.invoiceNumber,
        bookEntry: b,
        portalEntry: p,
        discrepancy: {
          taxableDiff: Math.round((b.taxableValue - p.taxableValue) * 100) / 100,
          taxDiff: Math.round((b.totalTax - portalTotalTax) * 100) / 100,
          notes: [
            `Taxable mismatch: Books ₹${b.taxableValue} vs Portal ₹${p.taxableValue}`,
            `Tax mismatch: Books ₹${b.totalTax} vs Portal ₹${portalTotalTax}`,
          ],
        },
      });
    }
  }

  // Find entries in Portal but missing in Books (Supplier filed, shop hasn't booked)
  let missingInBooksCount = 0;
  for (const [key, p] of portalMap.entries()) {
    if (!matchedPortalKeys.has(key)) {
      missingInBooksCount++;
      const pTax = p.igst + p.cgst + p.sgst;
      reconciledRecords.push({
        matchStatus: "missing_in_books",
        supplierGstin: p.supplierGstin,
        invoiceNumber: p.invoiceNumber,
        portalEntry: p,
        discrepancy: {
          taxableDiff: -p.taxableValue,
          taxDiff: -pTax,
          notes: ["Supplier filed invoice in GSTR-1, but not yet entered in Books."],
        },
      });
    }
  }

  return {
    reconciledRecords,
    summary: {
      totalBookInvoices: books.length,
      totalPortalInvoices: portal.length,
      exactMatchCount,
      mismatchCount,
      missingInPortalCount,
      missingInBooksCount,
      itcEligibleClaimAmount: Math.round(itcEligibleClaimAmount * 100) / 100,
      itcAtRiskAmount: Math.round(itcAtRiskAmount * 100) / 100,
    },
  };
}
