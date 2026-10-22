import { describe, it, expect } from "vitest";
import {
  extractUpiUtrFromNarration,
  reconcileBankStatementWithPos,
  type BankStatementLine,
  type PosPaymentRecord,
} from "@/server/reports/bankReconciliation";

describe("Bank Reconciliation & UPI Auto-Match (Line 45)", () => {
  it("extracts 12-digit UPI UTR / RRN from complex Indian bank narrations", () => {
    expect(extractUpiUtrFromNarration("UPI/CR/629218291024/RAHUL/HDFC/Pay")).toBe("629218291024");
    expect(extractUpiUtrFromNarration("NEFT-UTR:409281726354-PAYMENT")).toBe("409281726354");
    expect(extractUpiUtrFromNarration("CASH DEPOSIT BRANCH")).toBe(null);
  });

  it("auto-matches bank credit lines against POS UPI payments using UTR", () => {
    const bankLines: BankStatementLine[] = [
      {
        id: "bnk_1",
        transactionDate: "2026-10-18",
        valueDate: "2026-10-18",
        description: "UPI/CR/998877665544/AMBURAX STORE",
        referenceNumber: "998877665544",
        withdrawalMinor: 0,
        depositMinor: 149900, // ₹1,499
        runningBalanceMinor: 25000000,
      },
      {
        id: "bnk_2",
        transactionDate: "2026-10-18",
        valueDate: "2026-10-18",
        description: "CARD SETTLEMENT HDFC POS",
        withdrawalMinor: 0,
        depositMinor: 350000, // ₹3,500
        runningBalanceMinor: 25350000,
      },
      {
        id: "bnk_3",
        transactionDate: "2026-10-18",
        valueDate: "2026-10-18",
        description: "UNIDENTIFIED CASH TRANSFER",
        withdrawalMinor: 0,
        depositMinor: 50000, // ₹500
        runningBalanceMinor: 25400000,
      },
    ];

    const posPayments: PosPaymentRecord[] = [
      {
        salePaymentId: "pos_pay_1",
        saleId: "sale_101",
        billNumber: "BILL-101",
        paymentMethod: "UPI",
        paidAt: "2026-10-18T14:30:00Z",
        amountMinor: 149900,
        externalReference: "998877665544", // Exact matching UTR
      },
      {
        salePaymentId: "pos_pay_2",
        saleId: "sale_102",
        billNumber: "BILL-102",
        paymentMethod: "CARD",
        paidAt: "2026-10-18T16:15:00Z",
        amountMinor: 350000, // Matches bnk_2 by amount and date
      },
      {
        salePaymentId: "pos_pay_3",
        saleId: "sale_103",
        billNumber: "BILL-103",
        paymentMethod: "UPI",
        paidAt: "2026-10-18T17:00:00Z",
        amountMinor: 75000, // ₹750 not yet received in bank
        externalReference: "112233445566",
      },
    ];

    const result = reconcileBankStatementWithPos(bankLines, posPayments);

    expect(result.matchedCount).toBe(2);
    expect(result.matchedAmountMinor).toBe(499900); // ₹1,499 + ₹3,500 = ₹4,999

    // Match 1 was exact UTR
    expect(result.matches[0]?.matchType).toBe("EXACT_UTR");
    expect(result.matches[0]?.billNumber).toBe("BILL-101");

    // Match 2 was amount and timestamp
    expect(result.matches[1]?.matchType).toBe("AMOUNT_AND_TIMESTAMP");
    expect(result.matches[1]?.billNumber).toBe("BILL-102");

    // Unmatched suspense bank line
    expect(result.unmatchedBankLines.length).toBe(1);
    expect(result.unmatchedBankLines[0]?.depositMinor).toBe(50000); // ₹500

    // Unmatched POS sale payment
    expect(result.unmatchedPosPayments.length).toBe(1);
    expect(result.unmatchedPosPayments[0]?.billNumber).toBe("BILL-103");
  });
});
