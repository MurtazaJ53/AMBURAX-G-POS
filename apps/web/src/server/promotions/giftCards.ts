/**
 * Stored-Value Prepaid Gift Cards & Digital Vouchers Engine (Line 11)
 *
 * Implements:
 * 1. Gift Card Issue: Generates 16-digit card code with 4-digit security PIN and initial prepaid balance.
 * 2. Balance Verification & Reload: Checks current card balance and allows balance top-ups.
 * 3. POS Checkout Redemption: Deducts purchase amount from gift card, supports partial balance payments.
 * 4. Expiry & Status Management: Handles ACTIVE, EXPIRED, FROZEN, and REDEEMED states.
 */

import { createHash, randomBytes } from "crypto";

export type GiftCardStatus = "ACTIVE" | "EXPIRED" | "FROZEN" | "REDEEMED";

export interface GiftCardRecord {
  id: string;
  cardNumber: string; // 16-digit card number (e.g. 6032-XXXX-XXXX-XXXX)
  cardPinHash: string; // SHA-256 hash of 4-digit PIN
  initialBalanceMinor: number;
  currentBalanceMinor: number;
  purchasedByCustomerId?: string;
  recipientPhone?: string;
  recipientName?: string;
  expiresAt: string;
  createdAt: string;
  status: GiftCardStatus;
}

export interface GiftCardTransaction {
  id: string;
  cardId: string;
  saleId?: string;
  type: "ISSUE" | "REDEEM" | "RELOAD" | "REFUND";
  amountMinor: number;
  balanceAfterMinor: number;
  timestamp: string;
}

export function hashGiftCardPin(pin: string): string {
  return createHash("sha256").update(pin.trim()).digest("hex");
}

export function generateCardNumber(): string {
  const segment1 = "6032";
  const segment2 = Math.floor(1000 + Math.random() * 9000).toString();
  const segment3 = Math.floor(1000 + Math.random() * 9000).toString();
  const segment4 = Math.floor(1000 + Math.random() * 9000).toString();
  return `${segment1}-${segment2}-${segment3}-${segment4}`;
}

export function issueGiftCard(params: {
  amountMinor: number;
  pin: string;
  purchasedByCustomerId?: string;
  recipientPhone?: string;
  recipientName?: string;
  validityMonths?: number;
}): { card: GiftCardRecord; rawPin: string } {
  if (params.amountMinor <= 0) {
    throw new Error("Gift card balance must be greater than zero.");
  }
  if (!/^\d{4}$/.test(params.pin)) {
    throw new Error("Gift card PIN must be exactly 4 numeric digits.");
  }

  const now = new Date();
  const validity = params.validityMonths ?? 12;
  const expiresAt = new Date(now.getFullYear(), now.getMonth() + validity, now.getDate()).toISOString();

  const card: GiftCardRecord = {
    id: `gc_${Date.now()}_${randomBytes(4).toString("hex")}`,
    cardNumber: generateCardNumber(),
    cardPinHash: hashGiftCardPin(params.pin),
    initialBalanceMinor: params.amountMinor,
    currentBalanceMinor: params.amountMinor,
    purchasedByCustomerId: params.purchasedByCustomerId,
    recipientPhone: params.recipientPhone,
    recipientName: params.recipientName,
    expiresAt,
    createdAt: now.toISOString(),
    status: "ACTIVE",
  };

  return { card, rawPin: params.pin };
}

export function redeemGiftCard(
  card: GiftCardRecord,
  enteredPin: string,
  redemptionAmountMinor: number,
  saleId?: string
): {
  updatedCard: GiftCardRecord;
  amountDeductedMinor: number;
  remainingBillMinor: number;
  transaction: GiftCardTransaction;
} {
  if (card.status !== "ACTIVE") {
    throw new Error(`Gift card is not active. Current status: ${card.status}`);
  }

  if (new Date(card.expiresAt) < new Date()) {
    throw new Error("Gift card has expired.");
  }

  const enteredHash = hashGiftCardPin(enteredPin);
  if (enteredHash !== card.cardPinHash) {
    throw new Error("Invalid 4-digit gift card PIN.");
  }

  if (card.currentBalanceMinor <= 0) {
    throw new Error("Gift card balance is zero.");
  }

  // Deduct up to available balance
  const amountToDeduct = Math.min(card.currentBalanceMinor, redemptionAmountMinor);
  const remainingBill = redemptionAmountMinor - amountToDeduct;
  const newBalance = card.currentBalanceMinor - amountToDeduct;

  const updatedCard: GiftCardRecord = {
    ...card,
    currentBalanceMinor: newBalance,
    status: newBalance === 0 ? "REDEEMED" : "ACTIVE",
  };

  const transaction: GiftCardTransaction = {
    id: `gctx_${Date.now()}`,
    cardId: card.id,
    saleId,
    type: "REDEEM",
    amountMinor: amountToDeduct,
    balanceAfterMinor: newBalance,
    timestamp: new Date().toISOString(),
  };

  return {
    updatedCard,
    amountDeductedMinor: amountToDeduct,
    remainingBillMinor: remainingBill,
    transaction,
  };
}

export function reloadGiftCard(
  card: GiftCardRecord,
  topUpAmountMinor: number
): { updatedCard: GiftCardRecord; transaction: GiftCardTransaction } {
  if (topUpAmountMinor <= 0) throw new Error("Reload amount must be positive.");

  const newBalance = card.currentBalanceMinor + topUpAmountMinor;
  const updatedCard: GiftCardRecord = {
    ...card,
    currentBalanceMinor: newBalance,
    status: "ACTIVE",
  };

  const transaction: GiftCardTransaction = {
    id: `gctx_${Date.now()}`,
    cardId: card.id,
    type: "RELOAD",
    amountMinor: topUpAmountMinor,
    balanceAfterMinor: newBalance,
    timestamp: new Date().toISOString(),
  };

  return { updatedCard, transaction };
}
