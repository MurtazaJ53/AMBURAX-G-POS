/**
 * Advance Booking & Layaway Installment Schedule Engine (Line 10)
 *
 * Implements:
 * 1. Layaway Plan Creation: Reserves merchandise against minimum down payment (e.g. 20%).
 * 2. Installment Schedule Generator: Splits balance into weekly, bi-weekly, or monthly installments.
 * 3. Payment Processing: Records installment payments, updates balance due, and issues receipt.
 * 4. Completion & Release: Unlocks reserved merchandise for customer pickup upon full payment.
 * 5. Cancellation & Restocking: Handles cancellations with customizable restocking fee and store credit refund.
 */

export type LayawayStatus = "ACTIVE" | "COMPLETED" | "DEFAULTED" | "CANCELLED";

export interface LayawayInstallment {
  installmentNumber: number;
  dueDate: string; // YYYY-MM-DD
  amountDueMinor: number;
  amountPaidMinor: number;
  paidAt?: string;
  paymentMethod?: string;
  isPaid: boolean;
}

export interface LayawayPlan {
  id: string;
  planNumber: string;
  customerId: string;
  customerName: string;
  phone: string;
  storeId: string;
  items: Array<{
    variantId: string;
    productName: string;
    quantity: number;
    priceMinor: number;
  }>;
  totalAmountMinor: number;
  downPaymentMinor: number;
  totalPaidMinor: number;
  balanceDueMinor: number;
  installments: LayawayInstallment[];
  status: LayawayStatus;
  expiresAt: string;
  createdAt: string;
}

export function createLayawayPlan(params: {
  customerId: string;
  customerName: string;
  phone: string;
  storeId: string;
  items: Array<{
    variantId: string;
    productName: string;
    quantity: number;
    priceMinor: number;
  }>;
  downPaymentMinor: number;
  numberOfInstallments: number;
  installmentFrequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY";
  startDate?: Date;
}): LayawayPlan {
  const totalAmountMinor = params.items.reduce((acc, i) => acc + i.priceMinor * i.quantity, 0);

  if (params.downPaymentMinor < Math.round(totalAmountMinor * 0.10)) {
    throw new Error("Down payment must be at least 10% of total order value.");
  }

  const balanceToSplit = Math.max(0, totalAmountMinor - params.downPaymentMinor);
  const baseInstallment = Math.floor(balanceToSplit / params.numberOfInstallments);
  let remainder = balanceToSplit % params.numberOfInstallments;

  const now = params.startDate || new Date();
  const installments: LayawayInstallment[] = [];

  const daysStep = params.installmentFrequency === "WEEKLY" ? 7 : params.installmentFrequency === "BIWEEKLY" ? 14 : 30;

  for (let i = 1; i <= params.numberOfInstallments; i++) {
    const due = new Date(now.getTime() + i * daysStep * 86400000);
    const amount = baseInstallment + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;

    installments.push({
      installmentNumber: i,
      dueDate: due.toISOString().substring(0, 10),
      amountDueMinor: amount,
      amountPaidMinor: 0,
      isPaid: false,
    });
  }

  const finalDue = installments[installments.length - 1]?.dueDate || now.toISOString().substring(0, 10);
  const planNumber = `LAY-${Date.now().toString().slice(-6)}`;

  return {
    id: `lay_${Date.now()}`,
    planNumber,
    customerId: params.customerId,
    customerName: params.customerName,
    phone: params.phone,
    storeId: params.storeId,
    items: params.items,
    totalAmountMinor,
    downPaymentMinor: params.downPaymentMinor,
    totalPaidMinor: params.downPaymentMinor,
    balanceDueMinor: balanceToSplit,
    installments,
    status: balanceToSplit === 0 ? "COMPLETED" : "ACTIVE",
    expiresAt: finalDue,
    createdAt: now.toISOString(),
  };
}

export function recordLayawayPayment(
  plan: LayawayPlan,
  paymentAmountMinor: number,
  paymentMethod = "UPI"
): LayawayPlan {
  if (plan.status !== "ACTIVE") {
    throw new Error(`Cannot accept payment on layaway plan with status: ${plan.status}`);
  }

  let remainingPayment = paymentAmountMinor;
  const updatedInstallments = plan.installments.map(inst => {
    if (inst.isPaid || remainingPayment <= 0) return inst;

    const needed = inst.amountDueMinor - inst.amountPaidMinor;
    const pay = Math.min(needed, remainingPayment);
    remainingPayment -= pay;

    const newPaid = inst.amountPaidMinor + pay;
    return {
      ...inst,
      amountPaidMinor: newPaid,
      isPaid: newPaid >= inst.amountDueMinor,
      paidAt: new Date().toISOString(),
      paymentMethod,
    };
  });

  const newTotalPaid = plan.totalPaidMinor + paymentAmountMinor;
  const newBalanceDue = Math.max(0, plan.totalAmountMinor - newTotalPaid);
  const isCompleted = newBalanceDue === 0;

  return {
    ...plan,
    totalPaidMinor: newTotalPaid,
    balanceDueMinor: newBalanceDue,
    installments: updatedInstallments,
    status: isCompleted ? "COMPLETED" : "ACTIVE",
  };
}

export function cancelLayawayPlan(
  plan: LayawayPlan,
  restockingFeePct = 5
): {
  cancelledPlan: LayawayPlan;
  restockingFeeMinor: number;
  refundStoreCreditMinor: number;
} {
  const restockingFee = Math.round((plan.totalAmountMinor * restockingFeePct) / 100);
  const refundAmount = Math.max(0, plan.totalPaidMinor - restockingFee);

  return {
    cancelledPlan: {
      ...plan,
      status: "CANCELLED",
    },
    restockingFeeMinor: restockingFee,
    refundStoreCreditMinor: refundAmount,
  };
}
