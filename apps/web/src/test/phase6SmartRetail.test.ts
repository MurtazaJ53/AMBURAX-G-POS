import { describe, it, expect } from "vitest";
import { recommendSizeForCustomer } from "../server/pos/sizeFitSuggester";
import { generateGarmentHangtag } from "../server/catalog/garmentQrHangtag";
import { analyzeSizeRun } from "../server/inventory/brokenSizeRun";
import { generateFestivalPlan } from "../server/promotions/festivalPlanner";
import { analyzeSupplierDefects } from "../server/purchasing/defectAnalytics";
import { generateUpiPayLink, matchUpiPaymentToInvoice } from "../server/pos/upiPaymentLink";
import { evaluatePartyCreditRisk } from "../server/wholesale/creditRiskScorer";
import { generateControlTowerDigest } from "../server/ops/controlTower";

describe("Phase 6 - Smart Retail & Owner Control Tower Modules", () => {
  describe("1. Size & Fit Recommender", () => {
    it("suggests size L when customer historically buys size L in target brand", () => {
      const history = [
        {
          brand: "Raymond",
          category: "Formal Shirt",
          size: "L",
          purchaseDate: "2026-05-10",
        },
        {
          brand: "Raymond",
          category: "Formal Shirt",
          size: "L",
          purchaseDate: "2026-08-15",
        },
      ];

      const rec = recommendSizeForCustomer("CUST-1", "Raymond", "Formal Shirt", history);
      expect(rec).not.toBeNull();
      expect(rec?.recommendedSize).toBe("L");
      expect(rec?.confidenceScore).toBeGreaterThanOrEqual(80);
      expect(rec?.reasoning).toContain("size L in Raymond");
    });
  });

  describe("2. Garment QR Hangtag Generator", () => {
    it("generates digital size chart, care instructions and customer reorder url", () => {
      const hangtag = generateGarmentHangtag({
        sku: "RAY-SH-L-01",
        designNumber: "DN-402",
        brand: "Raymond",
        name: "Linen Stripe Shirt",
        size: "L",
        mrp: 2499,
        fabric: "100% Pure Linen",
        careInstructions: ["Machine wash cold", "Warm iron"],
        sizeChart: {
          chestInches: 42,
          waistInches: 38,
          lengthInches: 30,
          shoulderInches: 18.5,
        },
        reorderBaseUrl: "https://shop.ambrx.in",
      });

      expect(hangtag.customerMobilePageUrl).toBe("https://shop.ambrx.in/p/DN-402?sku=RAY-SH-L-01&size=L");
      expect(hangtag.printablePayloadText).toContain("BRAND:Raymond|DESIGN:DN-402|SIZE:L");
      expect(hangtag.printablePayloadText).toContain("CHEST:42\"");
      expect(hangtag.careSymbols).toContain("WASH_30C");
    });
  });

  describe("3. Broken Size-Run Detection", () => {
    it("flags design as severe broken run when core sizes are sold out", () => {
      const alert = analyzeSizeRun({
        designNumber: "DN-900",
        brand: "Manyavar",
        category: "Kurta",
        originalMrp: 3999,
        sizes: [
          { size: "S", inStockQty: 4, isCoreSize: false },
          { size: "M", inStockQty: 0, isCoreSize: true }, // Core sold out
          { size: "L", inStockQty: 0, isCoreSize: true }, // Core sold out
          { size: "XL", inStockQty: 0, isCoreSize: true }, // Core sold out
          { size: "XXL", inStockQty: 6, isCoreSize: false },
        ],
      });

      expect(alert.isBroken).toBe(true);
      expect(alert.brokenSeverity).toBe("severe");
      expect(alert.coreSizesStockout).toEqual(["M", "L", "XL"]);
      expect(alert.suggestedDiscountPercent).toBeGreaterThanOrEqual(30);
    });
  });

  describe("4. Festival Planner Engine", () => {
    it("forecasts procurement deadline and stock budget from past Diwali sales", () => {
      const pastDiwali = [
        {
          festivalName: "Diwali",
          year: 2025,
          startDate: "2025-10-20",
          endDate: "2025-10-25",
          peakDayDate: "2025-10-23",
          categorySales: [
            { category: "Kurta Pajama", unitsSold: 400, revenue: 800000 },
            { category: "Sarees", unitsSold: 600, revenue: 1500000 },
          ],
        },
      ];

      const plan = generateFestivalPlan(pastDiwali, {
        festivalName: "Diwali",
        targetYear: 2026,
        startDate: "2026-11-08",
        expectedGrowthRatePercent: 20, // +20% growth
        procurementLeadTimeWeeks: 6, // 6 weeks lead time
      });

      expect(plan.festivalName).toBe("Diwali");
      expect(plan.orderDeadlineDate).toBe("2026-09-27"); // 6 weeks before Nov 8
      expect(plan.promoCampaignStartDate).toBe("2026-10-25"); // 2 weeks before
      expect(plan.categoryProjections.find((c) => c.category === "Kurta Pajama")?.forecastUnits).toBe(480);
    });
  });

  describe("5. Defect Analytics Engine", () => {
    it("identifies high-risk defect designs and computes recommended debit note", () => {
      const defectRecords = [
        {
          id: "DEF-1",
          invoiceId: "INV-1",
          sku: "KURTA-RED-M",
          designNumber: "DN-101",
          brand: "Anouk",
          supplierId: "SUPP-A",
          supplierName: "Surat Fab Mills",
          defectReason: "color_bleeding" as const,
          costPrice: 600,
          returnDate: "2026-10-10",
        },
        {
          id: "DEF-2",
          invoiceId: "INV-2",
          sku: "KURTA-RED-L",
          designNumber: "DN-101",
          brand: "Anouk",
          supplierId: "SUPP-A",
          supplierName: "Surat Fab Mills",
          defectReason: "color_bleeding" as const,
          costPrice: 600,
          returnDate: "2026-10-12",
        },
        {
          id: "DEF-3",
          invoiceId: "INV-3",
          sku: "KURTA-RED-XL",
          designNumber: "DN-101",
          brand: "Anouk",
          supplierId: "SUPP-A",
          supplierName: "Surat Fab Mills",
          defectReason: "fabric_tear" as const,
          costPrice: 600,
          returnDate: "2026-10-14",
        },
      ];

      const summary = analyzeSupplierDefects(defectRecords);
      expect(summary).toHaveLength(1);
      expect(summary[0]!.supplierName).toBe("Surat Fab Mills");
      expect(summary[0]!.totalDefectCost).toBe(1800);
      expect(summary[0]!.recommendedDebitNoteAmount).toBe(1800);
      expect(summary[0]!.highRiskDesigns).toContain("DN-101");
    });
  });

  describe("6. UPI Pay-Link & Auto Invoice Match", () => {
    it("generates NPCI-compliant UPI URI and matches incoming webhook settlement", () => {
      const payLink = generateUpiPayLink({
        storeVpa: "amburax@icici",
        storeName: "Amburax Textiles",
        invoiceId: "INV-999",
        invoiceNumber: "SAL/26/999",
        partyId: "P-44",
        amount: 14500,
      });

      expect(payLink.upiUri).toContain("upi://pay?pa=amburax%40icici");
      expect(payLink.upiUri).toContain("am=14500.00");
      expect(payLink.transactionRef).toContain("UPI-SAL26999");

      const match = matchUpiPaymentToInvoice(
        {
          transactionRef: payLink.transactionRef,
          bankRrn: "428910293812",
          payerVpa: "customer@okaxis",
          amountPaid: 14500,
          status: "SUCCESS",
          timestamp: "2026-10-19T10:00:00Z",
        },
        {
          invoiceId: "INV-999",
          invoiceNumber: "SAL/26/999",
          pendingAmount: 14500,
        }
      );

      expect(match.isMatched).toBe(true);
      expect(match.reconciliationStatus).toBe("fully_settled");
      expect(match.remainingPending).toBe(0);
    });
  });

  describe("7. Party Credit-Risk Scoring", () => {
    it("penalizes late payment delays and cheque bounces into Watchlist tier", () => {
      const evalResult = evaluatePartyCreditRisk({
        partyId: "PARTY-99",
        partyName: "Ambica Garments",
        annualTurnoverWithStore: 1200000, // 100k/month
        totalInvoicesCount: 15,
        averagePaymentDelayDays: 32, // frequent delay
        maxPaymentDelayDays: 60,
        chequeBounceCount: 1, // dishonour
        disputedInvoiceCount: 1,
        currentOutstanding: 150000,
        existingCreditLimit: 100000, // breached
      });

      expect(evalResult.creditGrade).toBe("C_WATCHLIST");
      expect(evalResult.requiresPdcSecurity).toBe(true);
      expect(evalResult.recommendedCreditDays).toBe(15);
      expect(evalResult.notes.some((n) => n.includes("PDC"))).toBe(true);
    });
  });

  describe("8. Owner Control Tower Surveillance", () => {
    it("flags cash shortage, high voids, and returns store rankings", () => {
      const counters = [
        {
          storeId: "S-1",
          storeName: "Ring Road Flagship",
          counterId: "C-1",
          counterName: "Ground Floor Billing",
          cashierName: "Ramesh",
          grossSales: 150000,
          netSales: 145000,
          billsCount: 35,
          cashReported: 50000,
          cashPhysicalCounted: 49500,
          cashVariance: -500, // Shortage!
          discountsTotal: 5000,
          voidBillsCount: 4, // High voids!
          negativeStockSalesCount: 1,
        },
        {
          storeId: "S-2",
          storeName: "Millennium Mall",
          counterId: "C-2",
          counterName: "First Floor Cashier",
          cashierName: "Suresh",
          grossSales: 80000,
          netSales: 80000,
          billsCount: 20,
          cashReported: 30000,
          cashPhysicalCounted: 30000,
          cashVariance: 0,
          discountsTotal: 0,
          voidBillsCount: 0,
          negativeStockSalesCount: 0,
        },
      ];

      const digest = generateControlTowerDigest(counters);
      expect(digest.totalNetworkSales).toBe(225000);
      expect(digest.totalNetworkCashVariance).toBe(-500);
      expect(digest.topPerformingStore).toBe("Ring Road Flagship");

      const shortageAlert = digest.alerts.find((a) => a.type === "cash_shortage");
      expect(shortageAlert).toBeDefined();
      expect(shortageAlert?.severity).toBe("critical");

      const voidAlert = digest.alerts.find((a) => a.type === "excess_voids");
      expect(voidAlert).toBeDefined();
    });
  });
});
