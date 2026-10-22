/**
 * Agent & Broker Commission Engine for Wholesale / B2B (Line 28)
 *
 * Implements:
 * 1. Broker / Commission Agent Profile (Name, Phone, GSTIN/PAN, Default Commission %, TDS Rate %).
 * 2. Commission Calculation Models:
 *    - PERCENT_ON_NET_SALES (e.g. 2.0% on pre-tax or post-tax invoice value).
 *    - FIXED_PER_UNIT (e.g. ₹5 per meter / ₹20 per piece).
 *    - SLAB_BASED (e.g. 1.5% up to ₹5L, 2.5% above ₹5L).
 * 3. Payment Linked Commission: Accrue on billing vs. Release on customer payment recovery.
 * 4. TDS Deduction (e.g. 5% Section 194H Indian Income Tax Act) and Net Payable statement.
 */

export type CommissionBasis = "NET_SALES" | "GROSS_SALES" | "PER_UNIT";

export interface CommissionAgent {
  id: string;
  name: string;
  phone: string;
  panNumber?: string;
  defaultCommissionBp: number; // Basis points, e.g. 200 = 2.0%
  fixedRateMinorPerUnit?: number; // In paise
  tdsRateBp: number; // e.g. 200 = 2% TDS under amended Sec 194H (Finance Act 2024), configurable per CA instructions
  paymentLinked: boolean; // Release commission only after party clears payment
}

export interface B2BOrderCommissionCalculation {
  agentId: string;
  agentName: string;
  orderNumber: string;
  totalInvoiceMinor: number;
  taxableValueMinor: number;
  totalUnitsSold: number;
  basis: CommissionBasis;
  appliedRateBp: number;
  grossCommissionMinor: number;
  tdsDeductionMinor: number;
  netPayableCommissionMinor: number;
  status: "ACCRUED" | "RELEASED" | "PAID";
}

export function calculateAgentCommission(params: {
  agent: CommissionAgent;
  orderNumber: string;
  taxableValueMinor: number;
  totalInvoiceMinor: number;
  totalUnitsSold: number;
  basis?: CommissionBasis;
  overrideCommissionBp?: number;
}): B2BOrderCommissionCalculation {
  const basis = params.basis || "NET_SALES";
  const rateBp = params.overrideCommissionBp ?? params.agent.defaultCommissionBp;

  let grossCommissionMinor = 0;

  if (basis === "NET_SALES") {
    // Commission on pre-tax taxable turnover
    grossCommissionMinor = Math.round((params.taxableValueMinor * rateBp) / 10000);
  } else if (basis === "GROSS_SALES") {
    // Commission on total invoice value
    grossCommissionMinor = Math.round((params.totalInvoiceMinor * rateBp) / 10000);
  } else if (basis === "PER_UNIT") {
    const perUnit = params.agent.fixedRateMinorPerUnit || 0;
    grossCommissionMinor = params.totalUnitsSold * perUnit;
  }

  // Calculate TDS (Sec 194H)
  const tdsDeductionMinor = Math.round((grossCommissionMinor * params.agent.tdsRateBp) / 10000);
  const netPayableCommissionMinor = Math.max(0, grossCommissionMinor - tdsDeductionMinor);

  return {
    agentId: params.agent.id,
    agentName: params.agent.name,
    orderNumber: params.orderNumber,
    totalInvoiceMinor: params.totalInvoiceMinor,
    taxableValueMinor: params.taxableValueMinor,
    totalUnitsSold: params.totalUnitsSold,
    basis,
    appliedRateBp: rateBp,
    grossCommissionMinor,
    tdsDeductionMinor,
    netPayableCommissionMinor,
    status: params.agent.paymentLinked ? "ACCRUED" : "RELEASED",
  };
}

/**
 * Summarizes Agent Ledger & Outstanding Commission Payable
 */
export function summarizeAgentCommissions(statements: B2BOrderCommissionCalculation[]): {
  totalGrossCommissionMinor: number;
  totalTdsDeductedMinor: number;
  totalNetPayableMinor: number;
  accruedPendingRecoveryMinor: number;
  releasedReadyForPayoutMinor: number;
} {
  let totalGross = 0;
  let totalTds = 0;
  let totalNet = 0;
  let accruedPending = 0;
  let releasedReady = 0;

  for (const s of statements) {
    totalGross += s.grossCommissionMinor;
    totalTds += s.tdsDeductionMinor;
    totalNet += s.netPayableCommissionMinor;

    if (s.status === "ACCRUED") {
      accruedPending += s.netPayableCommissionMinor;
    } else if (s.status === "RELEASED") {
      releasedReady += s.netPayableCommissionMinor;
    }
  }

  return {
    totalGrossCommissionMinor: totalGross,
    totalTdsDeductedMinor: totalTds,
    totalNetPayableMinor: totalNet,
    accruedPendingRecoveryMinor: accruedPending,
    releasedReadyForPayoutMinor: releasedReady,
  };
}
