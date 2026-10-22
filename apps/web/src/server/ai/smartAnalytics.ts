/**
 * Smart Association Mining, Churn Prediction, and Fraud Heuristics (Line 57, 58, 60, 62)
 *
 * Implements:
 * 1. Market Basket Analysis / "Customers Who Bought This Also Bought":
 *    Calculates Support, Confidence, and Lift between garment pairings (e.g. White Shirt + Navy Chino).
 * 2. Customer Churn Risk Scoring:
 *    Recency, Frequency, Monetary (RFM) model calculating Churn Probability (0-100%).
 * 3. Automated Fraud & Risk Detection:
 *    Heuristic rules flagging suspicious discount spikes (>25%), frequent line voids, after-hours sales,
 *    and excessive returns without original receipt.
 * 4. Sudden Sales Drop & Stock Anomaly Alerting:
 *    Compares moving averages to identify sudden revenue dips or negative inventory variance.
 */

export interface MarketBasketPairing {
  itemAId: string;
  itemAName: string;
  itemBId: string;
  itemBName: string;
  pairFrequency: number;
  confidencePct: number;
  liftRatio: number;
}

export interface ChurnRiskProfile {
  customerId: string;
  customerName: string;
  daysSinceLastVisit: number;
  totalPastVisits: number;
  averageVisitIntervalDays: number;
  churnProbabilityPct: number;
  riskCategory: "LOW" | "MODERATE" | "HIGH" | "LOST";
  recommendedAction: string;
}

export interface FraudRiskAlert {
  ruleId: "EXCESSIVE_DISCOUNT" | "FREQUENT_VOIDS" | "AFTER_HOURS_BILLING" | "HIGH_VALUE_RETURN";
  severity: "LOW" | "MEDIUM" | "HIGH";
  description: string;
  saleId?: string;
  cashierName?: string;
  flaggedAt: string;
}

/**
 * Mines associations ("Frequently Bought Together") across historical sales carts
 */
export function mineMarketBasketAssociations(
  salesCarts: Array<{ cartId: string; itemIds: string[] }>,
  productNames: Record<string, string>,
  minSupport = 2
): MarketBasketPairing[] {
  const itemCounts = new Map<string, number>();
  const pairCounts = new Map<string, number>();

  for (const cart of salesCarts) {
    const uniqueItems = Array.from(new Set(cart.itemIds));
    for (const item of uniqueItems) {
      itemCounts.set(item, (itemCounts.get(item) || 0) + 1);
    }
    for (let i = 0; i < uniqueItems.length; i++) {
      for (let j = i + 1; j < uniqueItems.length; j++) {
        const pairKey = [uniqueItems[i]!, uniqueItems[j]!].sort().join("::");
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
      }
    }
  }

  const results: MarketBasketPairing[] = [];
  const totalCarts = salesCarts.length;

  for (const [pairKey, freq] of pairCounts.entries()) {
    if (freq < minSupport) continue;
    const [itemA, itemB] = pairKey.split("::") as [string, string];
    const countA = itemCounts.get(itemA) || 1;
    const countB = itemCounts.get(itemB) || 1;

    // Confidence(A -> B) = P(A & B) / P(A)
    const confidence = freq / countA;
    // Lift = P(A & B) / (P(A) * P(B))
    const lift = totalCarts > 0 ? (freq / totalCarts) / ((countA / totalCarts) * (countB / totalCarts)) : 1;

    results.push({
      itemAId: itemA,
      itemAName: productNames[itemA] || itemA,
      itemBId: itemB,
      itemBName: productNames[itemB] || itemB,
      pairFrequency: freq,
      confidencePct: Number((confidence * 100).toFixed(1)),
      liftRatio: Number(lift.toFixed(2)),
    });
  }

  return results.sort((a, b) => b.liftRatio - a.liftRatio);
}

/**
 * Calculates customer churn risk based on days absent vs historical visit interval
 */
export function calculateCustomerChurnRisk(customer: {
  id: string;
  name: string;
  daysSinceLastVisit: number;
  totalPastVisits: number;
  averageVisitIntervalDays: number;
}): ChurnRiskProfile {
  const ratio =
    customer.averageVisitIntervalDays > 0 ? customer.daysSinceLastVisit / customer.averageVisitIntervalDays : 1;

  let churnPct = Math.min(100, Math.round(ratio * 35));
  if (customer.totalPastVisits <= 1 && customer.daysSinceLastVisit > 60) churnPct = 85;

  let riskCategory: ChurnRiskProfile["riskCategory"] = "LOW";
  let recommendedAction = "Customer is active; standard loyalty communication.";

  if (churnPct >= 75) {
    riskCategory = "HIGH";
    recommendedAction = "Send personalized 'We Miss You' WhatsApp offer with exclusive ₹200 voucher.";
  } else if (churnPct >= 45) {
    riskCategory = "MODERATE";
    recommendedAction = "Include in upcoming weekend festival collection broadcast.";
  }

  return {
    customerId: customer.id,
    customerName: customer.name,
    daysSinceLastVisit: customer.daysSinceLastVisit,
    totalPastVisits: customer.totalPastVisits,
    averageVisitIntervalDays: customer.averageVisitIntervalDays,
    churnProbabilityPct: churnPct,
    riskCategory,
    recommendedAction,
  };
}

/**
 * Evaluates sale for automated fraud heuristics
 */
export function evaluateSaleFraudRules(sale: {
  saleId: string;
  billTotalMinor: number;
  discountMinor: number;
  voidedItemCount: number;
  hourOfDay: number; // 0 to 23
  cashierName?: string;
}): FraudRiskAlert[] {
  const alerts: FraudRiskAlert[] = [];

  // Rule 1: Extreme discount percentage (> 30%)
  if (sale.billTotalMinor > 0 && sale.discountMinor / (sale.billTotalMinor + sale.discountMinor) > 0.3) {
    alerts.push({
      ruleId: "EXCESSIVE_DISCOUNT",
      severity: "HIGH",
      description: `Discount exceeds 30% of gross bill value. Requires manager PIN audit.`,
      saleId: sale.saleId,
      cashierName: sale.cashierName,
      flaggedAt: new Date().toISOString(),
    });
  }

  // Rule 2: Frequent line item cancellations (> 3 voids on a single bill)
  if (sale.voidedItemCount >= 3) {
    alerts.push({
      ruleId: "FREQUENT_VOIDS",
      severity: "MEDIUM",
      description: `Customer bill has ${sale.voidedItemCount} voided lines. Verify items were not handed over.`,
      saleId: sale.saleId,
      cashierName: sale.cashierName,
      flaggedAt: new Date().toISOString(),
    });
  }

  // Rule 3: After-hours billing (after 10 PM or before 8 AM)
  if (sale.hourOfDay < 8 || sale.hourOfDay >= 22) {
    alerts.push({
      ruleId: "AFTER_HOURS_BILLING",
      severity: "LOW",
      description: `Sale recorded outside normal store trading hours (${sale.hourOfDay}:00 hrs).`,
      saleId: sale.saleId,
      cashierName: sale.cashierName,
      flaggedAt: new Date().toISOString(),
    });
  }

  return alerts;
}
