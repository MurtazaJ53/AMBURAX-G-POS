/**
 * Party Credit-Risk Scoring & Predictive Limit Engine
 * Predicts wholesale customer late payment likelihood, default probability,
 * and dynamically recommends prudent credit limits from historical repayment cycles.
 */

export interface PartyPaymentHistory {
  partyId: string;
  partyName: string;
  annualTurnoverWithStore: number;
  totalInvoicesCount: number;
  averagePaymentDelayDays: number; // e.g. Paid in 42 days against 30 day terms = +12 delay
  maxPaymentDelayDays: number;
  chequeBounceCount: number;
  disputedInvoiceCount: number;
  currentOutstanding: number;
  existingCreditLimit: number;
}

export interface CreditRiskEvaluation {
  partyId: string;
  partyName: string;
  riskScore: number; // 0 to 100 (higher = riskier)
  creditGrade: "A_PRIME" | "B_STANDARD" | "C_WATCHLIST" | "D_HIGH_RISK";
  recommendedCreditLimit: number;
  recommendedCreditDays: number;
  requiresPdcSecurity: boolean;
  notes: string[];
}

export function evaluatePartyCreditRisk(
  party: PartyPaymentHistory
): CreditRiskEvaluation {
  let score = 0;
  const notes: string[] = [];

  // 1. Average delay impact (0 to 35 pts)
  if (party.averagePaymentDelayDays > 45) {
    score += 35;
    notes.push("Chronic late payment habit (>45 days average delay)");
  } else if (party.averagePaymentDelayDays > 20) {
    score += 20;
    notes.push("Frequent payment delays (20-45 days past terms)");
  } else if (party.averagePaymentDelayDays > 5) {
    score += 10;
  }

  // 2. Cheque bounces (0 to 30 pts)
  if (party.chequeBounceCount >= 3) {
    score += 30;
    notes.push("Severe cheque bounce history (>= 3 bounces)");
  } else if (party.chequeBounceCount >= 1) {
    score += 15;
    notes.push("Has prior cheque dishonour history");
  }

  // 3. Outstanding vs Existing Limit ratio (0 to 20 pts)
  if (party.existingCreditLimit > 0) {
    const utilization = party.currentOutstanding / party.existingCreditLimit;
    if (utilization >= 1.0) {
      score += 20;
      notes.push("Credit limit fully exhausted or breached");
    } else if (utilization >= 0.8) {
      score += 10;
    }
  }

  // 4. Disputes (0 to 15 pts)
  if (party.disputedInvoiceCount > 2) {
    score += 15;
    notes.push("High frequency of invoice rate disputes");
  }

  score = Math.min(100, Math.max(0, score));

  // Determine Grade, Recommended Limit and Terms
  let creditGrade: "A_PRIME" | "B_STANDARD" | "C_WATCHLIST" | "D_HIGH_RISK" = "B_STANDARD";
  let recommendedCreditDays = 30;
  let recommendedCreditLimit = party.existingCreditLimit;
  let requiresPdcSecurity = false;

  const monthlyTurnover = party.annualTurnoverWithStore / 12;

  if (score < 25) {
    creditGrade = "A_PRIME";
    recommendedCreditDays = 45;
    // Prime clients can safely receive up to 1.5x monthly turnover
    recommendedCreditLimit = Math.max(party.existingCreditLimit, Math.round(monthlyTurnover * 1.5));
    requiresPdcSecurity = false;
  } else if (score < 50) {
    creditGrade = "B_STANDARD";
    recommendedCreditDays = 30;
    recommendedCreditLimit = Math.round(monthlyTurnover * 1.0);
    requiresPdcSecurity = false;
  } else if (score < 75) {
    creditGrade = "C_WATCHLIST";
    recommendedCreditDays = 15;
    recommendedCreditLimit = Math.round(monthlyTurnover * 0.4);
    requiresPdcSecurity = true;
    notes.push("Require Post-Dated Cheque (PDC) before order dispatch");
  } else {
    creditGrade = "D_HIGH_RISK";
    recommendedCreditDays = 0;
    recommendedCreditLimit = 0;
    requiresPdcSecurity = true;
    notes.push("Put on strict Cash-On-Delivery (COD) / Advance payment only");
  }

  return {
    partyId: party.partyId,
    partyName: party.partyName,
    riskScore: score,
    creditGrade,
    recommendedCreditLimit,
    recommendedCreditDays,
    requiresPdcSecurity,
    notes,
  };
}
