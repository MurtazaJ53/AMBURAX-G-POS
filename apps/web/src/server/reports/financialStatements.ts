/**
 * Double-Entry Store P&L and Balance Sheet Generator (Line 42)
 *
 * Implements:
 * 1. Chart of Accounts Categorizer (Revenue, COGS, Operating Expenses, Current Assets, Current Liabilities, Owner Equity).
 * 2. Store Profit & Loss Statement (Gross Sales, Net Sales, Cost of Goods Sold, Gross Margin, Operating Expenses, Net Operating Profit).
 * 3. Simplified Balance Sheet (Assets: Cash in Till + Bank + Inventory Valuation + Khata Receivables; Liabilities: Supplier Payables + GST Output Liability).
 */

export interface ProfitAndLossStatement {
  storeId: string;
  startDate: string;
  endDate: string;
  grossSalesRevenueMinor: number;
  salesReturnsMinor: number;
  discountsGivenMinor: number;
  netSalesRevenueMinor: number;
  costOfGoodsSoldMinor: number;
  grossProfitMinor: number;
  grossProfitMarginPct: number;
  operatingExpenses: {
    salariesAndWagesMinor: number;
    storeRentMinor: number;
    pettyCashAndUtilitiesMinor: number;
    totalOpExMinor: number;
  };
  netOperatingProfitMinor: number;
  netProfitMarginPct: number;
}

export interface StoreBalanceSheet {
  storeId: string;
  asOfDate: string;
  assets: {
    cashInTillMinor: number;
    bankBalancesMinor: number;
    inventoryAtCostMinor: number;
    customerKhataReceivablesMinor: number;
    totalAssetsMinor: number;
  };
  liabilities: {
    supplierPayablesMinor: number;
    gstTaxPayableMinor: number;
    totalLiabilitiesMinor: number;
  };
  netOwnerEquityMinor: number;
}

export function generateStoreProfitAndLoss(params: {
  storeId: string;
  startDate: string;
  endDate: string;
  grossSalesMinor: number;
  returnsMinor: number;
  discountsMinor: number;
  cogsMinor: number;
  salariesMinor: number;
  rentMinor: number;
  pettyUtilitiesMinor: number;
}): ProfitAndLossStatement {
  const netSales = Math.max(0, params.grossSalesMinor - params.returnsMinor - params.discountsMinor);
  const grossProfit = netSales - params.cogsMinor;
  const grossMargin = netSales > 0 ? Number(((grossProfit / netSales) * 100).toFixed(2)) : 0;

  const totalOpEx = params.salariesMinor + params.rentMinor + params.pettyUtilitiesMinor;
  const netOperatingProfit = grossProfit - totalOpEx;
  const netMargin = netSales > 0 ? Number(((netOperatingProfit / netSales) * 100).toFixed(2)) : 0;

  return {
    storeId: params.storeId,
    startDate: params.startDate,
    endDate: params.endDate,
    grossSalesRevenueMinor: params.grossSalesMinor,
    salesReturnsMinor: params.returnsMinor,
    discountsGivenMinor: params.discountsMinor,
    netSalesRevenueMinor: netSales,
    costOfGoodsSoldMinor: params.cogsMinor,
    grossProfitMinor: grossProfit,
    grossProfitMarginPct: grossMargin,
    operatingExpenses: {
      salariesAndWagesMinor: params.salariesMinor,
      storeRentMinor: params.rentMinor,
      pettyCashAndUtilitiesMinor: params.pettyUtilitiesMinor,
      totalOpExMinor: totalOpEx,
    },
    netOperatingProfitMinor: netOperatingProfit,
    netProfitMarginPct: netMargin,
  };
}

export function generateStoreBalanceSheet(params: {
  storeId: string;
  asOfDate: string;
  cashInTillMinor: number;
  bankBalancesMinor: number;
  inventoryAtCostMinor: number;
  customerKhataReceivablesMinor: number;
  supplierPayablesMinor: number;
  gstTaxPayableMinor: number;
}): StoreBalanceSheet {
  const totalAssets =
    params.cashInTillMinor +
    params.bankBalancesMinor +
    params.inventoryAtCostMinor +
    params.customerKhataReceivablesMinor;

  const totalLiabilities = params.supplierPayablesMinor + params.gstTaxPayableMinor;
  const netEquity = totalAssets - totalLiabilities;

  return {
    storeId: params.storeId,
    asOfDate: params.asOfDate,
    assets: {
      cashInTillMinor: params.cashInTillMinor,
      bankBalancesMinor: params.bankBalancesMinor,
      inventoryAtCostMinor: params.inventoryAtCostMinor,
      customerKhataReceivablesMinor: params.customerKhataReceivablesMinor,
      totalAssetsMinor: totalAssets,
    },
    liabilities: {
      supplierPayablesMinor: params.supplierPayablesMinor,
      gstTaxPayableMinor: params.gstTaxPayableMinor,
      totalLiabilitiesMinor: totalLiabilities,
    },
    netOwnerEquityMinor: netEquity,
  };
}
