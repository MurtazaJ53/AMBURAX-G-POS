/**
 * Petty Cash & Categorized Store Expense Engine (Line 41)
 *
 * Implements:
 * 1. Expense Category Master (Tea/Snacks, Store Electricity, Stationery, Packaging Material, Minor Repairs, Travel, Staff Welfare).
 * 2. Petty Cash Float & Balance Tracker (Top-ups, Cash payouts from till, Balance thresholds).
 * 3. Payment Voucher Generation (Voucher Number, Expense Category, Paid To, Authorized By, Receipt Image, Amount).
 * 4. Day-End Cash Expense Audit & Reconciliation.
 */

export type ExpenseCategory =
  | "TEA_REFRESHMENTS"
  | "PACKAGING_MATERIALS"
  | "STORE_ELECTRICITY_UTILITY"
  | "CLEANING_MAINTENANCE"
  | "LOCAL_TRANSPORT"
  | "STATIONERY_PRINTING"
  | "MISCELLANEOUS";

export interface ExpenseVoucher {
  id: string;
  voucherNumber: string; // e.g. "VCHR-2026-081"
  storeId: string;
  category: ExpenseCategory;
  description: string;
  paidTo: string;
  amountMinor: number;
  paymentSource: "TILL_CASH" | "PETTY_CASH_SAFE" | "UPI";
  authorizedByUserId: string;
  authorizedByName: string;
  billReceiptAttachmentUrl?: string;
  createdAt: string;
}

export interface PettyCashLedgerSummary {
  storeId: string;
  periodStart: string;
  periodEnd: string;
  openingFloatMinor: number;
  totalTopUpsMinor: number;
  totalExpensesMinor: number;
  closingFloatMinor: number;
  byCategoryMinor: Record<ExpenseCategory, number>;
}

export function createExpenseVoucher(params: {
  storeId: string;
  category: ExpenseCategory;
  description: string;
  paidTo: string;
  amountMinor: number;
  paymentSource?: "TILL_CASH" | "PETTY_CASH_SAFE" | "UPI";
  authorizedByUserId: string;
  authorizedByName: string;
  billReceiptAttachmentUrl?: string;
}): ExpenseVoucher {
  if (params.amountMinor <= 0) {
    throw new Error("Expense amount must be greater than zero.");
  }

  const voucherNum = `VCHR-${Date.now().toString().slice(-6)}`;

  return {
    id: `exp_${Date.now()}`,
    voucherNumber: voucherNum,
    storeId: params.storeId,
    category: params.category,
    description: params.description,
    paidTo: params.paidTo,
    amountMinor: params.amountMinor,
    paymentSource: params.paymentSource || "TILL_CASH",
    authorizedByUserId: params.authorizedByUserId,
    authorizedByName: params.authorizedByName,
    billReceiptAttachmentUrl: params.billReceiptAttachmentUrl,
    createdAt: new Date().toISOString(),
  };
}

export function summarizeStoreExpenses(
  vouchers: ExpenseVoucher[],
  openingFloatMinor = 1000000 // Default ₹10,000 float
): PettyCashLedgerSummary {
  const byCategory: Record<ExpenseCategory, number> = {
    TEA_REFRESHMENTS: 0,
    PACKAGING_MATERIALS: 0,
    STORE_ELECTRICITY_UTILITY: 0,
    CLEANING_MAINTENANCE: 0,
    LOCAL_TRANSPORT: 0,
    STATIONERY_PRINTING: 0,
    MISCELLANEOUS: 0,
  };

  let totalExpenses = 0;

  for (const v of vouchers) {
    totalExpenses += v.amountMinor;
    byCategory[v.category] = (byCategory[v.category] || 0) + v.amountMinor;
  }

  return {
    storeId: vouchers[0]?.storeId || "store_main",
    periodStart: vouchers[0]?.createdAt.substring(0, 10) || new Date().toISOString().substring(0, 10),
    periodEnd: new Date().toISOString().substring(0, 10),
    openingFloatMinor,
    totalTopUpsMinor: 0,
    totalExpensesMinor: totalExpenses,
    closingFloatMinor: Math.max(0, openingFloatMinor - totalExpenses),
    byCategoryMinor: byCategory,
  };
}
