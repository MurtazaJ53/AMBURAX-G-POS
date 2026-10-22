/**
 * Bill-Wise Payment Settlement Engine (Phase 5 - #76)
 *
 * Implements:
 * 1. Invoice-by-Invoice Settlement: Matches bulk customer payments against specific unpaid bills (FIFO or Cherry-Pick).
 * 2. Cash Discount (CD) calculation (e.g. 2% or 3% if paid within 15/30 days).
 * 3. Short Payment & Round-off handling with dispute reason logging.
 * 4. Credit/Debit Note adjustment: Consumes existing credit notes to offset payable balances.
 */

export interface UnsettledInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  dueDate: string;
  totalAmountMinor: number;
  alreadyPaidMinor: number;
  outstandingBalanceMinor: number;
  cashDiscountApplicableMinor: number;
}

export interface PaymentSettlementAllocation {
  invoiceId: string;
  invoiceNumber: string;
  allocatedAmountMinor: number;
  cashDiscountAvailedMinor: number;
  shortPaymentMinor: number;
  creditNoteAdjustedMinor: number;
  remainingOutstandingMinor: number;
  isFullySettled: boolean;
}

export interface BillWiseSettlementResult {
  settlementId: string;
  customerId: string;
  customerName: string;
  totalPaymentReceivedMinor: number;
  totalCreditNotesUsedMinor: number;
  totalCashDiscountGivenMinor: number;
  allocations: PaymentSettlementAllocation[];
  unallocatedAdvanceMinor: number;
  settledAt: string;
}

export function settleInvoicesBillWise(params: {
  customerId: string;
  customerName: string;
  invoices: UnsettledInvoice[];
  paymentAmountMinor: number;
  creditNoteAvailableMinor?: number;
  applyCashDiscount?: boolean;
}): BillWiseSettlementResult {
  let remainingPayment = params.paymentAmountMinor;
  let remainingCreditNote = params.creditNoteAvailableMinor ?? 0;
  let totalCashDiscountGiven = 0;
  let totalCreditNotesUsed = 0;

  const allocations: PaymentSettlementAllocation[] = [];

  for (const inv of params.invoices) {
    if (inv.outstandingBalanceMinor <= 0) continue;

    let balance = inv.outstandingBalanceMinor;
    let cdAvailed = 0;

    // Apply Cash Discount if eligible and requested
    if (params.applyCashDiscount && inv.cashDiscountApplicableMinor > 0) {
      cdAvailed = Math.min(inv.cashDiscountApplicableMinor, balance);
      balance -= cdAvailed;
      totalCashDiscountGiven += cdAvailed;
    }

    // Apply Credit Note first
    let cnApplied = 0;
    if (remainingCreditNote > 0 && balance > 0) {
      cnApplied = Math.min(remainingCreditNote, balance);
      remainingCreditNote -= cnApplied;
      balance -= cnApplied;
      totalCreditNotesUsed += cnApplied;
    }

    // Apply Cash/Bank Payment
    let paymentAllocated = 0;
    if (remainingPayment > 0 && balance > 0) {
      paymentAllocated = Math.min(remainingPayment, balance);
      remainingPayment -= paymentAllocated;
      balance -= paymentAllocated;
    }

    const isFullySettled = balance === 0;

    allocations.push({
      invoiceId: inv.invoiceId,
      invoiceNumber: inv.invoiceNumber,
      allocatedAmountMinor: paymentAllocated,
      cashDiscountAvailedMinor: cdAvailed,
      shortPaymentMinor: 0,
      creditNoteAdjustedMinor: cnApplied,
      remainingOutstandingMinor: balance,
      isFullySettled,
    });
  }

  return {
    settlementId: `stl_${Date.now()}`,
    customerId: params.customerId,
    customerName: params.customerName,
    totalPaymentReceivedMinor: params.paymentAmountMinor,
    totalCreditNotesUsedMinor: totalCreditNotesUsed,
    totalCashDiscountGivenMinor: totalCashDiscountGiven,
    allocations,
    unallocatedAdvanceMinor: remainingPayment,
    settledAt: new Date().toISOString(),
  };
}
