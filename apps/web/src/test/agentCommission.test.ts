import { describe, it, expect } from "vitest";
import {
  calculateAgentCommission,
  summarizeAgentCommissions,
  type CommissionAgent,
} from "@/server/wholesale/agentCommission";

describe("Agent/Broker Commission Engine (Line 28)", () => {
  const sampleAgent: CommissionAgent = {
    id: "agent_sharma",
    name: "Sharma Cloth Brokerage",
    phone: "9825012345",
    panNumber: "AAECS1234F",
    defaultCommissionBp: 200, // 2.0%
    fixedRateMinorPerUnit: 2500, // ₹25 per piece
    tdsRateBp: 500, // 5% TDS under 194H
    paymentLinked: true,
  };

  it("calculates percentage commission on net taxable sales with 5% TDS", () => {
    // Taxable: ₹5,00,000 (50,000,000 paise), Total: ₹5,25,000 (with 5% GST)
    const comm = calculateAgentCommission({
      agent: sampleAgent,
      orderNumber: "B2B-ORD-8801",
      taxableValueMinor: 50000000,
      totalInvoiceMinor: 52500000,
      totalUnitsSold: 200,
      basis: "NET_SALES",
    });

    // 2% of ₹5,00,000 = ₹10,000 (1,000,000 paise)
    expect(comm.grossCommissionMinor).toBe(1000000);
    // 5% TDS on ₹10,000 = ₹500 (50,000 paise)
    expect(comm.tdsDeductionMinor).toBe(50000);
    // Net payable = ₹9,500 (950,000 paise)
    expect(comm.netPayableCommissionMinor).toBe(950000);
    // Payment linked => starts as ACCRUED
    expect(comm.status).toBe("ACCRUED");
  });

  it("calculates fixed per-unit commission accurately", () => {
    const comm = calculateAgentCommission({
      agent: sampleAgent,
      orderNumber: "B2B-ORD-8802",
      taxableValueMinor: 20000000,
      totalInvoiceMinor: 21000000,
      totalUnitsSold: 100, // 100 pieces @ ₹25 = ₹2,500 gross
      basis: "PER_UNIT",
    });

    expect(comm.grossCommissionMinor).toBe(250000); // ₹2,500
    expect(comm.tdsDeductionMinor).toBe(12500); // 5% TDS = ₹125
    expect(comm.netPayableCommissionMinor).toBe(237500); // ₹2,375 net
  });

  it("summarizes agent statements distinguishing accrued vs released", () => {
    const stmt1 = calculateAgentCommission({
      agent: sampleAgent,
      orderNumber: "ORD-1",
      taxableValueMinor: 10000000, // ₹1,00,000 -> 2% = ₹2,000 gross, ₹1,900 net
      totalInvoiceMinor: 10500000,
      totalUnitsSold: 50,
    });

    const stmt2 = {
      ...calculateAgentCommission({
        agent: sampleAgent,
        orderNumber: "ORD-2",
        taxableValueMinor: 20000000, // ₹2,00,000 -> 2% = ₹4,000 gross, ₹3,800 net
        totalInvoiceMinor: 21000000,
        totalUnitsSold: 100,
      }),
      status: "RELEASED" as const, // Released after party paid
    };

    const summary = summarizeAgentCommissions([stmt1, stmt2]);
    expect(summary.totalGrossCommissionMinor).toBe(600000); // ₹6,000
    expect(summary.totalTdsDeductedMinor).toBe(30000);      // ₹300
    expect(summary.totalNetPayableMinor).toBe(570000);      // ₹5,700
    expect(summary.accruedPendingRecoveryMinor).toBe(190000); // ₹1,900
    expect(summary.releasedReadyForPayoutMinor).toBe(380000); // ₹3,800
  });
});
