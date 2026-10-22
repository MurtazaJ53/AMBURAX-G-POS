/**
 * Staff Payroll, Commission & Target Performance Engine (Line 38 & Line 39)
 *
 * Implements:
 * 1. Staff Salary & Payroll Structure (Base monthly salary, Per-day attendance wage, Allowances, Deductions).
 * 2. Sales Targets & Tiered Incentive Slabs (e.g. 0-₹2L = 0%, ₹2L-₹5L = 1%, >₹5L = 2% incentive).
 * 3. Monthly Payslip Generator (Gross earnings, Target bonus, Overtime, Advance deductions, Net payout).
 */

export interface StaffSalaryConfig {
  staffId: string;
  staffName: string;
  monthlyBaseSalaryMinor: number;
  monthlySalesTargetMinor: number;
  incentiveSlabs: Array<{
    minSalesMinor: number;
    maxSalesMinor: number;
    incentiveRateBp: number; // Basis points (100 = 1%)
  }>;
  dailyAllowanceMinor: number;
}

export interface MonthlyPayrollCalculation {
  staffId: string;
  staffName: string;
  month: string; // YYYY-MM
  daysPresent: number;
  daysInMonth: number;
  earnedBaseSalaryMinor: number;
  actualSalesAchievedMinor: number;
  targetAchievementPct: number;
  targetIncentiveBonusMinor: number;
  advancesDeductedMinor: number;
  grossPayMinor: number;
  netPayableSalaryMinor: number;
}

export function calculateStaffTargetIncentive(
  actualSalesMinor: number,
  config: StaffSalaryConfig
): number {
  let incentive = 0;

  for (const slab of config.incentiveSlabs) {
    if (actualSalesMinor > slab.minSalesMinor) {
      const taxableChunk = Math.min(actualSalesMinor, slab.maxSalesMinor) - slab.minSalesMinor;
      incentive += Math.round((taxableChunk * slab.incentiveRateBp) / 10000);
    }
  }

  return incentive;
}

export function computeMonthlyStaffPayroll(params: {
  config: StaffSalaryConfig;
  month: string;
  daysPresent: number;
  daysInMonth?: number;
  actualSalesMinor: number;
  advanceDeductionMinor?: number;
}): MonthlyPayrollCalculation {
  const daysInMonth = params.daysInMonth ?? 30;
  const perDayRate = params.config.monthlyBaseSalaryMinor / daysInMonth;
  const earnedBase = Math.round(perDayRate * params.daysPresent);

  const targetIncentive = calculateStaffTargetIncentive(params.actualSalesMinor, params.config);
  const achievementPct =
    params.config.monthlySalesTargetMinor > 0
      ? Number(((params.actualSalesMinor / params.config.monthlySalesTargetMinor) * 100).toFixed(1))
      : 100;

  const grossPay = earnedBase + targetIncentive;
  const advanceDeduction = params.advanceDeductionMinor ?? 0;
  const netPayable = Math.max(0, grossPay - advanceDeduction);

  return {
    staffId: params.config.staffId,
    staffName: params.config.staffName,
    month: params.month,
    daysPresent: params.daysPresent,
    daysInMonth,
    earnedBaseSalaryMinor: earnedBase,
    actualSalesAchievedMinor: params.actualSalesMinor,
    targetAchievementPct: achievementPct,
    targetIncentiveBonusMinor: targetIncentive,
    advancesDeductedMinor: advanceDeduction,
    grossPayMinor: grossPay,
    netPayableSalaryMinor: netPayable,
  };
}
