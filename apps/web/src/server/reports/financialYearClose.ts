/**
 * Financial Year Closing & Period Lock Engine
 * Performs Year-End closing, rolls forward ledger balances into opening balances for next FY,
 * and locks the previous financial period from modifications.
 */

export interface FinancialPeriod {
  fyCode: string; // e.g. "FY2025-26"
  startDate: string; // "2025-04-01"
  endDate: string; // "2026-03-31"
  isClosed: boolean;
  closedAt?: string;
  closedBy?: string;
}

export interface LedgerBalance {
  partyId: string;
  partyName: string;
  closingDebit: number;
  closingCredit: number;
  netBalance: number; // Positive = Debit, Negative = Credit
}

export interface InventoryValuationItem {
  sku: string;
  itemName: string;
  closingQty: number;
  unitCost: number;
  valuationAmount: number;
}

export interface YearEndClosingSummary {
  previousFy: FinancialPeriod;
  nextFy: FinancialPeriod;
  totalReceivablesCarriedForward: number;
  totalPayablesCarriedForward: number;
  totalClosingStockValuation: number;
  partiesRolledOver: number;
  itemsRolledOver: number;
  closedAt: string;
}

export function validatePeriodLock(
  period: FinancialPeriod,
  transactionDate: string
): { isAllowed: boolean; errorReason?: string } {
  if (period.isClosed) {
    return {
      isAllowed: false,
      errorReason: `Transactions cannot be posted to closed financial year ${period.fyCode}`,
    };
  }

  const tx = new Date(transactionDate).getTime();
  const start = new Date(period.startDate).getTime();
  const end = new Date(period.endDate).getTime();

  if (tx < start || tx > end) {
    return {
      isAllowed: false,
      errorReason: `Date ${transactionDate} is outside financial period range (${period.startDate} to ${period.endDate})`,
    };
  }

  return { isAllowed: true };
}

export function executeFinancialYearClose(
  currentPeriod: FinancialPeriod,
  nextFyCode: string,
  partyBalances: LedgerBalance[],
  stockValuations: InventoryValuationItem[],
  closedByUserId: string
): {
  updatedPeriod: FinancialPeriod;
  nextPeriod: FinancialPeriod;
  summary: YearEndClosingSummary;
} {
  if (currentPeriod.isClosed) {
    throw new Error(`Period ${currentPeriod.fyCode} is already closed.`);
  }

  const nowIso = new Date().toISOString();

  // Close previous period
  const updatedPeriod: FinancialPeriod = {
    ...currentPeriod,
    isClosed: true,
    closedAt: nowIso,
    closedBy: closedByUserId,
  };

  // Derive next FY dates
  const nextStart = new Date(currentPeriod.endDate);
  nextStart.setDate(nextStart.getDate() + 1);
  const nextEnd = new Date(nextStart);
  nextEnd.setFullYear(nextEnd.getFullYear() + 1);
  nextEnd.setDate(nextEnd.getDate() - 1);

  const nextPeriod: FinancialPeriod = {
    fyCode: nextFyCode,
    startDate: nextStart.toISOString().slice(0, 10),
    endDate: nextEnd.toISOString().slice(0, 10),
    isClosed: false,
  };

  let totalReceivables = 0;
  let totalPayables = 0;
  for (const b of partyBalances) {
    if (b.netBalance > 0) {
      totalReceivables += b.netBalance;
    } else {
      totalPayables += Math.abs(b.netBalance);
    }
  }

  const totalStockValuation = stockValuations.reduce(
    (sum, item) => sum + item.valuationAmount,
    0
  );

  const summary: YearEndClosingSummary = {
    previousFy: updatedPeriod,
    nextFy: nextPeriod,
    totalReceivablesCarriedForward: Math.round(totalReceivables * 100) / 100,
    totalPayablesCarriedForward: Math.round(totalPayables * 100) / 100,
    totalClosingStockValuation: Math.round(totalStockValuation * 100) / 100,
    partiesRolledOver: partyBalances.length,
    itemsRolledOver: stockValuations.length,
    closedAt: nowIso,
  };

  return { updatedPeriod, nextPeriod, summary };
}
