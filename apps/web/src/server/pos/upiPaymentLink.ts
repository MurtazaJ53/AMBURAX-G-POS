/**
 * WhatsApp UPI Pay-Link & Auto Invoice Match Engine
 * Generates dynamic NPCI-compliant UPI payment intent URLs (upi://pay?pa=...&am=...&tn=...)
 * and processes incoming webhook notifications to automatically settle target invoices.
 */

export interface UpiPaymentIntentRequest {
  storeVpa: string; // e.g. "surattextiles@icici"
  storeName: string;
  invoiceId: string;
  invoiceNumber: string;
  partyId: string;
  amount: number;
}

export interface GeneratedUpiPayment {
  upiUri: string;
  dynamicQrData: string;
  webPayUrl: string;
  transactionRef: string;
}

export interface UpiWebhookCallback {
  transactionRef: string;
  bankRrn: string; // 12-digit Bank Retrieval Reference Number
  payerVpa: string;
  amountPaid: number;
  status: "SUCCESS" | "FAILED" | "PENDING";
  timestamp: string;
}

export function generateUpiPayLink(
  request: UpiPaymentIntentRequest,
  baseDomain: string = "https://pos.ambrx.in"
): GeneratedUpiPayment {
  const transactionRef = `UPI-${request.invoiceNumber.replace(/[^a-zA-Z0-9]/g, "")}-${Date.now().toString().slice(-6)}`;
  const cleanNote = `Payment for Inv ${request.invoiceNumber}`.slice(0, 50);

  // NPCI standard UPI link format
  const upiUri =
    `upi://pay?pa=${encodeURIComponent(request.storeVpa)}` +
    `&pn=${encodeURIComponent(request.storeName)}` +
    `&tr=${encodeURIComponent(transactionRef)}` +
    `&am=${encodeURIComponent(request.amount.toFixed(2))}` +
    `&cu=INR` +
    `&tn=${encodeURIComponent(cleanNote)}`;

  const webPayUrl = `${baseDomain.replace(/\/$/, "")}/pay/${encodeURIComponent(transactionRef)}`;

  return {
    upiUri,
    dynamicQrData: upiUri,
    webPayUrl,
    transactionRef,
  };
}

export function matchUpiPaymentToInvoice(
  callback: UpiWebhookCallback,
  targetInvoice: {
    invoiceId: string;
    invoiceNumber: string;
    pendingAmount: number;
  }
): {
  isMatched: boolean;
  settledAmount: number;
  remainingPending: number;
  reconciliationStatus: "fully_settled" | "partially_settled" | "payment_failed";
  auditLog: string;
} {
  if (callback.status !== "SUCCESS") {
    return {
      isMatched: false,
      settledAmount: 0,
      remainingPending: targetInvoice.pendingAmount,
      reconciliationStatus: "payment_failed",
      auditLog: `UPI payment ${callback.transactionRef} failed or was cancelled by customer.`,
    };
  }

  const settledAmount = Math.min(callback.amountPaid, targetInvoice.pendingAmount);
  const remainingPending = Math.round((targetInvoice.pendingAmount - settledAmount) * 100) / 100;

  return {
    isMatched: true,
    settledAmount,
    remainingPending,
    reconciliationStatus: remainingPending === 0 ? "fully_settled" : "partially_settled",
    auditLog: `UPI payment ₹${callback.amountPaid} (RRN: ${callback.bankRrn}) auto-matched to Invoice ${targetInvoice.invoiceNumber}.`,
  };
}
