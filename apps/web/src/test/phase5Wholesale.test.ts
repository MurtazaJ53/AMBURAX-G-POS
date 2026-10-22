import { describe, it, expect } from "vitest";
import { settleInvoicesBillWise } from "../server/wholesale/billSettlement";
import {
  registerCheque,
  depositCheques,
  clearCheque,
  bounceCheque,
  computePdcAging,
} from "../server/wholesale/pdcManager";
import { reconcileGstr2b } from "../server/tax/gstr2bReconcile";
import {
  parseTallyPartyCsv,
  parseItemStockCsv,
} from "../server/imports/dataMigration";
import {
  validatePeriodLock,
  executeFinancialYearClose,
} from "../server/reports/financialYearClose";
import { createPrepack, explodePrepackOrder } from "../server/pos/prepackBilling";
import {
  calculateDuesRiskScore,
  rankDebtorsForCollection,
  generateLocalizedReminderMessage,
} from "../server/ai/aiDuesRanking";
import { generateNightlyWhatsAppDigest } from "../server/notifications/nightlySummary";

describe("Phase 5 - Wholesale-Trade & Real-Shop Modules", () => {
  describe("1. Bill-wise Settlement & Cash Discount", () => {
    it("allocates payments across invoices with cash discount and credit note offsets", () => {
      const invoices = [
        {
          invoiceId: "INV-001",
          invoiceNumber: "SAL/26/001",
          invoiceDate: "2026-10-01",
          totalAmount: 10000,
          pendingAmount: 10000,
          eligibleForCashDiscount: true,
          cashDiscountPercent: 2, // 2% CD = ₹200
        },
        {
          invoiceId: "INV-002",
          invoiceNumber: "SAL/26/002",
          invoiceDate: "2026-10-05",
          totalAmount: 5000,
          pendingAmount: 5000,
          eligibleForCashDiscount: false,
        },
      ];

      const result = settleInvoicesBillWise({
        customerId: "PARTY-101",
        customerName: "Radhe Traders",
        invoices: [
          {
            invoiceId: "INV-001",
            invoiceNumber: "SAL/26/001",
            invoiceDate: "2026-10-01",
            dueDate: "2026-10-31",
            totalAmountMinor: 1000000,
            alreadyPaidMinor: 0,
            outstandingBalanceMinor: 1000000,
            cashDiscountApplicableMinor: 20000, // ₹200 CD
          },
          {
            invoiceId: "INV-002",
            invoiceNumber: "SAL/26/002",
            invoiceDate: "2026-10-05",
            dueDate: "2026-11-05",
            totalAmountMinor: 500000,
            alreadyPaidMinor: 0,
            outstandingBalanceMinor: 500000,
            cashDiscountApplicableMinor: 0,
          },
        ],
        paymentAmountMinor: 1000000, // ₹10,000 in minor
        creditNoteAvailableMinor: 80000, // ₹800 credit note
        applyCashDiscount: true,
      });

      expect(result.totalCashDiscountGivenMinor).toBe(20000); // ₹200
      expect(result.totalCreditNotesUsedMinor).toBe(80000); // ₹800
      expect(result.unallocatedAdvanceMinor).toBe(0); // All ₹10,000 allocated

      const inv1 = result.allocations.find((l) => l.invoiceId === "INV-001");
      expect(inv1?.isFullySettled).toBe(true);
      expect(inv1?.cashDiscountAvailedMinor).toBe(20000);
      expect(inv1?.creditNoteAdjustedMinor).toBe(80000);
      expect(inv1?.allocatedAmountMinor).toBe(900000); // 10,000 - 200 CD - 800 CN = 9,000 paid
      expect(inv1?.remainingOutstandingMinor).toBe(0);

      const inv2 = result.allocations.find((l) => l.invoiceId === "INV-002");
      expect(inv2?.isFullySettled).toBe(false);
      expect(inv2?.allocatedAmountMinor).toBe(100000); // Remaining 1,000 paid to INV-002
      expect(inv2?.remainingOutstandingMinor).toBe(400000); // 5,000 - 1,000 = 4,000 remaining
    });
  });

  describe("2. Post-Dated Cheque (PDC) Manager", () => {
    it("handles full lifecycle: register -> deposit -> clear and bounce tracking", () => {
      const ch1 = registerCheque({
        id: "PDC-1",
        chequeNumber: "982101",
        bankName: "HDFC Bank",
        partyId: "P-1",
        partyName: "Radhe Krishna Textiles",
        amount: 50000,
        chequeDate: "2026-10-25",
        invoicesCovered: ["INV-001"],
      });
      expect(ch1.status).toBe("received");

      const depositResult = depositCheques(
        [ch1],
        ["PDC-1"],
        "2026-10-22",
        "SBI Current A/c 54321"
      );
      expect(depositResult.batch.totalAmount).toBe(50000);
      expect(depositResult.updatedCheques[0]!.status).toBe("deposited");

      const cleared = clearCheque(depositResult.updatedCheques[0]!, "2026-10-26");
      expect(cleared.status).toBe("cleared");
      expect(cleared.clearanceDate).toBe("2026-10-26");
    });

    it("computes aging buckets for post-dated cheques", () => {
      const today = "2026-10-19";
      const cheques = [
        registerCheque({
          id: "PDC-1",
          chequeNumber: "101",
          bankName: "ICICI",
          partyId: "P-1",
          partyName: "Surat Sarees",
          amount: 25000,
          chequeDate: "2026-10-22", // 3 days away
          invoicesCovered: [],
        }),
        registerCheque({
          id: "PDC-2",
          chequeNumber: "102",
          bankName: "SBI",
          partyId: "P-1",
          partyName: "Surat Sarees",
          amount: 75000,
          chequeDate: "2026-11-15", // ~27 days away
          invoicesCovered: [],
        }),
      ];

      const aging = computePdcAging(cheques, today);
      expect(aging).toHaveLength(1);
      expect(aging[0]!.totalPdcAmount).toBe(100000);
      expect(aging[0]!.dueInDays.days0To7).toBe(25000);
      expect(aging[0]!.dueInDays.days16To30).toBe(75000);
    });
  });

  describe("3. GSTR-2B Purchase Matching", () => {
    it("flags exact match, missing in portal, and rate mismatches", () => {
      const books = [
        {
          id: "B-1",
          supplierGstin: "24AAAAA0000A1Z5",
          supplierName: "Apex Yarn Mills",
          invoiceNumber: "AYM/26/101",
          invoiceDate: "2026-10-05",
          taxableValue: 100000,
          igst: 5000,
          cgst: 0,
          sgst: 0,
          totalTax: 5000,
        },
        {
          id: "B-2",
          supplierGstin: "24BBBBB1111B1Z6",
          supplierName: "Bharat Weaving",
          invoiceNumber: "BW/26/045",
          invoiceDate: "2026-10-08",
          taxableValue: 50000,
          igst: 2500,
          cgst: 0,
          sgst: 0,
          totalTax: 2500,
        },
      ];

      const portal = [
        {
          supplierGstin: "24AAAAA0000A1Z5",
          invoiceNumber: "AYM/26/101",
          invoiceDate: "2026-10-05",
          invoiceType: "B2B" as const,
          taxableValue: 100000,
          igst: 5000,
          cgst: 0,
          sgst: 0,
          itcAvailable: true,
        },
      ];

      const result = reconcileGstr2b(books, portal);
      expect(result.summary.exactMatchCount).toBe(1);
      expect(result.summary.missingInPortalCount).toBe(1); // Bharat Weaving missing
      expect(result.summary.itcEligibleClaimAmount).toBe(5000);
      expect(result.summary.itcAtRiskAmount).toBe(2500);
    });
  });

  describe("4. Tally / Excel Data Importer", () => {
    it("parses customer and supplier ledgers with credit/debit balances", () => {
      const mockCsvRows = [
        {
          "Ledger Name": "Shree Ambaji Silks",
          Group: "Sundry Debtors",
          "Opening Balance": "45,000 Dr",
          GSTIN: "24ABCDE1234F1Z5",
          Mobile: "9898012345",
          "Credit Period": "45",
        },
        {
          "Ledger Name": "Vardhman Mills",
          Group: "Sundry Creditors",
          "Opening Balance": "1,20,000 Cr",
          GSTIN: "03AABCV1234F1Z2",
          Mobile: "9417012345",
          "Credit Period": "30",
        },
      ];

      const parsed = parseTallyPartyCsv(mockCsvRows);
      expect(parsed.success).toBe(true);
      expect(parsed.validRows).toHaveLength(2);
      expect(parsed.validRows[0]!.openingBalance).toBe(45000);
      expect(parsed.validRows[0]!.type).toBe("customer");
      expect(parsed.validRows[1]!.openingBalance).toBe(-120000); // Cr = payable
      expect(parsed.validRows[1]!.type).toBe("supplier");
    });

    it("parses item catalog with MRP, cost, and opening stock", () => {
      const mockItemRows = [
        {
          "Item Name": "Cotton Formal Shirt - 40",
          SKU: "SH-CF-40",
          Brand: "Raymond",
          MRP: "1499",
          Cost: "650",
          "Opening Qty": "35",
          "GST %": "5",
        },
      ];

      const parsed = parseItemStockCsv(mockItemRows);
      expect(parsed.success).toBe(true);
      expect(parsed.validRows[0]!.name).toBe("Cotton Formal Shirt - 40");
      expect(parsed.validRows[0]!.mrp).toBe(1499);
      expect(parsed.validRows[0]!.openingStock).toBe(35);
    });
  });

  describe("5. Financial Year Closing & Period Lock", () => {
    it("locks previous year and rolls over receivables, payables, and stock", () => {
      const fy2526 = {
        fyCode: "FY2025-26",
        startDate: "2025-04-01",
        endDate: "2026-03-31",
        isClosed: false,
      };

      const partyBalances = [
        { partyId: "P1", partyName: "Party A", closingDebit: 50000, closingCredit: 0, netBalance: 50000 },
        { partyId: "P2", partyName: "Supplier B", closingDebit: 0, closingCredit: 30000, netBalance: -30000 },
      ];

      const stock = [
        { sku: "SKU-1", itemName: "Shirt", closingQty: 100, unitCost: 400, valuationAmount: 40000 },
      ];

      const result = executeFinancialYearClose(fy2526, "FY2026-27", partyBalances, stock, "USR-ADMIN");
      expect(result.updatedPeriod.isClosed).toBe(true);
      expect(result.nextPeriod.fyCode).toBe("FY2026-27");
      expect(result.nextPeriod.startDate).toBe("2026-04-01");
      expect(result.summary.totalReceivablesCarriedForward).toBe(50000);
      expect(result.summary.totalPayablesCarriedForward).toBe(30000);
      expect(result.summary.totalClosingStockValuation).toBe(40000);

      // Verify lock prevents back-dated entry
      const checkLock = validatePeriodLock(result.updatedPeriod, "2025-12-15");
      expect(checkLock.isAllowed).toBe(false);
      expect(checkLock.errorReason).toContain("cannot be posted to closed financial year");
    });
  });

  describe("6. Prepack / Ratio Set Billing", () => {
    it("creates a size-ratio prepack and explodes it accurately", () => {
      const prepack = createPrepack(
        "SET-DN-501",
        "DN-501",
        "Linen Kurta 1:2:2:1 Size Set",
        [
          { size: "S", ratio: 1, sku: "DN501-S" },
          { size: "M", ratio: 2, sku: "DN501-M" },
          { size: "L", ratio: 2, sku: "DN501-L" },
          { size: "XL", ratio: 1, sku: "DN501-XL" },
        ],
        450 // ₹450 per piece
      );

      expect(prepack.piecesPerPack).toBe(6);
      expect(prepack.packPrice).toBe(2700); // 6 * 450

      const order = explodePrepackOrder(prepack, 5); // 5 bundles
      expect(order.totalPieces).toBe(30);
      expect(order.totalAmount).toBe(13500); // 5 * 2700
      expect(order.explodedLines).toHaveLength(4);
      expect(order.explodedLines.find((l) => l.size === "M")?.quantityPieces).toBe(10);
    });
  });

  describe("7. AI Dues Ranking & Gujarati Reminders", () => {
    it("calculates overdue risk score and outputs Gujarati template", () => {
      const debtor = {
        partyId: "P-101",
        partyName: "Jalaram Collection",
        phone: "9825098250",
        totalDue: 250000,
        oldestInvoiceDays: 65,
        creditDaysAllowed: 30, // 35 days overdue
        bouncedChequeHistoryCount: 1,
        preferredLanguage: "gu" as const,
      };

      const score = calculateDuesRiskScore(debtor);
      expect(score).toBeGreaterThan(60); // 35 pts overdue + 20 pts amount + 15 pts bounce = 70

      const ranked = rankDebtorsForCollection([debtor], "Ambica Sarees");
      expect(ranked[0]!.priorityTier).toBe("High");
      expect(ranked[0]!.reminderMessage).toContain("નમસ્તે Jalaram Collection");
      expect(ranked[0]!.reminderMessage).toContain("Ambica Sarees");
      expect(ranked[0]!.reminderMessage).toContain("35 દિવસથી");
    });
  });

  describe("8. Nightly WhatsApp Owner Digest", () => {
    it("generates structured WhatsApp daily digest message", () => {
      const digest = generateNightlyWhatsAppDigest({
        date: "2026-10-19",
        storeName: "Surat Fashion Hub",
        ownerName: "Hareshbhai",
        salesMetrics: {
          grossSales: 245000,
          discounts: 5000,
          netSales: 240000,
          invoiceCount: 42,
        },
        collections: {
          cash: 40000,
          upi: 110000,
          chequeCleared: 90000,
          totalCollected: 240000,
        },
        dues: {
          totalOutstanding: 1250000,
          overdueAmount: 320000,
          partiesOverdueCount: 8,
        },
        stockAlerts: {
          lowStockItemCount: 12,
          deadStockValue: 85000,
        },
      });

      expect(digest).toContain("Surat Fashion Hub - Daily Business Report");
      expect(digest).toContain("Hareshbhai");
      expect(digest).toContain("Net Sales: *₹2,40,000*");
      expect(digest).toContain("Total Inflow:* *₹2,40,000*");
      expect(digest).toContain("Critical Overdue: *₹3,20,000*");
    });
  });
});
