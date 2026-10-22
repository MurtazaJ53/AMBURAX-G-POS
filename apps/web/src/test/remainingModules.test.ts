import { describe, it, expect } from "vitest";
import {
  createLayawayPlan,
  recordLayawayPayment,
  cancelLayawayPlan,
} from "@/server/sales/layaway";
import {
  issueGiftCard,
  redeemGiftCard,
  reloadGiftCard,
} from "@/server/promotions/giftCards";
import {
  computeMonthlyStaffPayroll,
  calculateStaffTargetIncentive,
} from "@/server/staff/staffPayroll";
import {
  createExpenseVoucher,
  summarizeStoreExpenses,
} from "@/server/ops/pettyCash";
import {
  generateStoreProfitAndLoss,
  generateStoreBalanceSheet,
} from "@/server/reports/financialStatements";
import {
  mineMarketBasketAssociations,
  calculateCustomerChurnRisk,
  evaluateSaleFraudRules,
} from "@/server/ai/smartAnalytics";
import {
  initiateTotpSetup,
  generateTotpCode,
  verifyTotpCode,
} from "@/server/identity/twoFactorAuth";

describe("Comprehensive Remaining Modules Suite (Lines 10, 11, 38, 39, 41, 42, 57, 58, 60, 72)", () => {
  // Line 10: Layaway
  it("Line 10: manages layaway installment lifecycle from booking to completion", () => {
    const plan = createLayawayPlan({
      customerId: "cust_1",
      customerName: "Sanjay Bhai",
      phone: "9825000000",
      storeId: "store_main",
      items: [{ variantId: "v1", productName: "Sherwani Set", quantity: 1, priceMinor: 1500000 }], // ₹15,000
      downPaymentMinor: 300000, // ₹3,000 down payment (20%)
      numberOfInstallments: 3,
      installmentFrequency: "BIWEEKLY",
    });

    expect(plan.status).toBe("ACTIVE");
    expect(plan.balanceDueMinor).toBe(1200000); // ₹12,000 remaining
    expect(plan.installments.length).toBe(3);
    expect(plan.installments[0]?.amountDueMinor).toBe(400000); // ₹4,000 per installment

    // Pay full remaining balance
    const completed = recordLayawayPayment(plan, 1200000, "UPI");
    expect(completed.status).toBe("COMPLETED");
    expect(completed.balanceDueMinor).toBe(0);
  });

  // Line 11: Gift Cards
  it("Line 11: issues and redeems stored-value prepaid gift cards with PIN", () => {
    const { card, rawPin } = issueGiftCard({
      amountMinor: 500000, // ₹5,000
      pin: "4321",
    });

    expect(card.status).toBe("ACTIVE");
    expect(card.currentBalanceMinor).toBe(500000);

    // Redeem ₹1,800 on a purchase
    const result = redeemGiftCard(card, rawPin, 180000, "sale_881");
    expect(result.amountDeductedMinor).toBe(180000);
    expect(result.remainingBillMinor).toBe(0);
    expect(result.updatedCard.currentBalanceMinor).toBe(320000); // ₹3,200 balance left
  });

  // Line 38 & 39: Staff Payroll & Targets
  it("Lines 38 & 39: computes staff monthly payroll with target incentives", () => {
    const payroll = computeMonthlyStaffPayroll({
      config: {
        staffId: "stf_1",
        staffName: "Amit Patel",
        monthlyBaseSalaryMinor: 2500000, // ₹25,000
        monthlySalesTargetMinor: 50000000, // ₹5,00,000 target
        dailyAllowanceMinor: 20000,
        incentiveSlabs: [
          { minSalesMinor: 0, maxSalesMinor: 30000000, incentiveRateBp: 0 },
          { minSalesMinor: 30000000, maxSalesMinor: 100000000, incentiveRateBp: 150 }, // 1.5% above 3L
        ],
      },
      month: "2026-10",
      daysPresent: 28,
      daysInMonth: 30,
      actualSalesMinor: 60000000, // ₹6,00,000 achieved (120% target)
      advanceDeductionMinor: 200000, // ₹2,000 advance adjustment
    });

    expect(payroll.targetAchievementPct).toBe(120);
    expect(payroll.targetIncentiveBonusMinor).toBeGreaterThan(0);
    expect(payroll.netPayableSalaryMinor).toBeGreaterThan(2000000);
  });

  // Line 41: Petty Cash
  it("Line 41: tracks categorized store expenses and closing cash float", () => {
    const v1 = createExpenseVoucher({
      storeId: "store_main",
      category: "TEA_REFRESHMENTS",
      description: "Staff morning tea and snacks",
      paidTo: "Kishan Tea Stall",
      amountMinor: 25000, // ₹250
      authorizedByUserId: "mgr_1",
      authorizedByName: "Manager",
    });

    const summary = summarizeStoreExpenses([v1], 500000); // ₹5,000 opening float
    expect(summary.totalExpensesMinor).toBe(25000);
    expect(summary.closingFloatMinor).toBe(475000); // ₹4,750 remaining
  });

  // Line 42: P&L and Balance Sheet
  it("Line 42: computes store profit & loss and balance sheet metrics", () => {
    const pnl = generateStoreProfitAndLoss({
      storeId: "store_main",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      grossSalesMinor: 200000000, // ₹20,00,000
      returnsMinor: 5000000,      // ₹50,000
      discountsMinor: 5000000,    // ₹50,000
      cogsMinor: 110000000,       // ₹11,00,000
      salariesMinor: 20000000,    // ₹2,00,000
      rentMinor: 15000000,        // ₹1,50,000
      pettyUtilitiesMinor: 5000000, // ₹50,000
    });

    // Net sales: 20L - 1L = 19L
    expect(pnl.netSalesRevenueMinor).toBe(190000000);
    // Gross profit: 19L - 11L = 8L
    expect(pnl.grossProfitMinor).toBe(80000000);
    // Net profit: 8L - 4L OpEx = 4L (₹4,00,000)
    expect(pnl.netOperatingProfitMinor).toBe(40000000);
  });

  // Lines 57, 58, 60: Associations, Churn, Fraud
  it("Lines 57, 58, 60: mines bought-together associations and flags discount fraud", () => {
    const carts = [
      { cartId: "c1", itemIds: ["item_shirt_white", "item_chino_navy"] },
      { cartId: "c2", itemIds: ["item_shirt_white", "item_chino_navy"] },
      { cartId: "c3", itemIds: ["item_shirt_white", "item_tie_silk"] },
    ];
    const names = {
      item_shirt_white: "White Oxford Shirt",
      item_chino_navy: "Navy Slim Chino",
      item_tie_silk: "Silk Tie",
    };

    const pairings = mineMarketBasketAssociations(carts, names, 2);
    expect(pairings.length).toBe(1);
    const pairNames = [pairings[0]?.itemAName, pairings[0]?.itemBName].join(" ");
    expect(pairNames).toContain("Shirt");
    expect(pairNames).toContain("Chino");

    // Fraud evaluation
    const alerts = evaluateSaleFraudRules({
      saleId: "sale_alert_1",
      billTotalMinor: 100000, // ₹1,000
      discountMinor: 60000,  // ₹600 (37.5% discount) -> EXCESSIVE
      voidedItemCount: 4,     // 4 voids -> FREQUENT
      hourOfDay: 23,          // 11 PM -> AFTER_HOURS
    });

    expect(alerts.length).toBe(3);
    expect(alerts.some(a => a.ruleId === "EXCESSIVE_DISCOUNT")).toBe(true);
    expect(alerts.some(a => a.ruleId === "FREQUENT_VOIDS")).toBe(true);
  });

  // Line 72: 2FA TOTP
  it("Line 72: generates and verifies 6-digit TOTP codes for authenticator apps", () => {
    const setup = initiateTotpSetup("owner@amburax.com", "AMBURAX POS");
    expect(setup.otpAuthUri).toContain("otpauth://totp/");
    expect(setup.secretBase32.length).toBeGreaterThan(16);
    expect(setup.backupCodes.length).toBe(8);

    const now = Date.now();
    const currentStep = Math.floor(now / 30000);
    const validCode = generateTotpCode(setup.secretBase32, currentStep);

    expect(validCode.length).toBe(6);
    expect(verifyTotpCode(setup.secretBase32, validCode, now)).toBe(true);
    expect(verifyTotpCode(setup.secretBase32, "000000", now)).toBe(false);
  });
});
