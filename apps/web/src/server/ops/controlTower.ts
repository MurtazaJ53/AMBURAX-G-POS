/**
 * Owner Control Tower Engine
 * Multi-store and multi-counter surveillance dashboard:
 * Compares branch sales, cash discrepancies, till mismatch exceptions,
 * and highlights operational anomalies in real time.
 */

export interface StoreCounterPerformance {
  storeId: string;
  storeName: string;
  counterId: string;
  counterName: string;
  cashierName: string;
  grossSales: number;
  netSales: number;
  billsCount: number;
  cashReported: number;
  cashPhysicalCounted: number;
  cashVariance: number; // positive = excess, negative = shortage
  discountsTotal: number;
  voidBillsCount: number;
  negativeStockSalesCount: number;
}

export interface ControlTowerAlert {
  severity: "critical" | "warning" | "info";
  storeName: string;
  counterName: string;
  type: "cash_shortage" | "excess_voids" | "high_discount_ratio" | "negative_stock";
  description: string;
  metricValue: number;
}

export interface ControlTowerSummary {
  asOfTimestamp: string;
  totalNetworkSales: number;
  totalNetworkCashVariance: number;
  topPerformingStore: string;
  alerts: ControlTowerAlert[];
  counterRankings: StoreCounterPerformance[];
}

export function generateControlTowerDigest(
  counters: StoreCounterPerformance[]
): ControlTowerSummary {
  const alerts: ControlTowerAlert[] = [];
  let totalNetworkSales = 0;
  let totalNetworkCashVariance = 0;

  for (const c of counters) {
    totalNetworkSales += c.netSales;
    totalNetworkCashVariance += c.cashVariance;

    // Check for cash variance anomaly
    if (c.cashVariance < -200) {
      alerts.push({
        severity: "critical",
        storeName: c.storeName,
        counterName: c.counterName,
        type: "cash_shortage",
        description: `Cash shortage of ₹${Math.abs(c.cashVariance)} reported by cashier ${c.cashierName}.`,
        metricValue: c.cashVariance,
      });
    }

    // Check for void bills anomaly (potential unauthorized cashier cancellations)
    if (c.voidBillsCount >= 3) {
      alerts.push({
        severity: "warning",
        storeName: c.storeName,
        counterName: c.counterName,
        type: "excess_voids",
        description: `${c.voidBillsCount} void/cancelled bills at ${c.counterName} today. Verify register audits.`,
        metricValue: c.voidBillsCount,
      });
    }

    // Check for high discount ratio (>15% of gross sales)
    if (c.grossSales > 0 && c.discountsTotal / c.grossSales > 0.15) {
      alerts.push({
        severity: "warning",
        storeName: c.storeName,
        counterName: c.counterName,
        type: "high_discount_ratio",
        description: `Unusually high discount ratio (${Math.round((c.discountsTotal / c.grossSales) * 100)}%) applied at ${c.counterName}.`,
        metricValue: c.discountsTotal,
      });
    }

    // Negative stock sales
    if (c.negativeStockSalesCount > 0) {
      alerts.push({
        severity: "warning",
        storeName: c.storeName,
        counterName: c.counterName,
        type: "negative_stock",
        description: `${c.negativeStockSalesCount} items billed with zero/negative recorded inventory.`,
        metricValue: c.negativeStockSalesCount,
      });
    }
  }

  // Sort counters by net sales descending
  const sortedCounters = [...counters].sort((a, b) => b.netSales - a.netSales);
  const topStore = sortedCounters[0]?.storeName ?? "None";

  return {
    asOfTimestamp: new Date().toISOString(),
    totalNetworkSales: Math.round(totalNetworkSales * 100) / 100,
    totalNetworkCashVariance: Math.round(totalNetworkCashVariance * 100) / 100,
    topPerformingStore: topStore,
    alerts,
    counterRankings: sortedCounters,
  };
}
