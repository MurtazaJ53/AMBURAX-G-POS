import {
  computeSaleTotals,
  validateQuantity,
  MAX_LINES_PER_SALE,
  MAX_LINE_QUANTITY,
  type SaleTotals,
} from "@/server/sales/saleTotals";
import type { CatalogItem, CustomerHit, ScannedItem } from "@/client/pos/types";

/**
 * The bill on screen.
 *
 * ## This is not a cart
 *
 * There is no Cart and no DraftSale in the backend, deliberately, and this file does not
 * invent one. What lives here is the cashier's working view of what they are about to ring
 * up — ephemeral, browser-only, authoritative over nothing. It is never persisted, never
 * given an id by the server, and never described to the operator as a transaction. The only
 * moment any of it becomes a business fact is `POST /sales`, and at that moment the server
 * re-reads every price and recomputes every total from the database.
 *
 * ## Why the totals here agree with the server's
 *
 * Because they are computed by the same pure function the sale transaction uses, from prices
 * the server itself sent. That makes them a faithful *preview* rather than an independent
 * calculation — the till never decides what a customer is charged, it only predicts it, and
 * the prediction is thrown away the moment the server answers.
 */

export interface BillLine {
  variantId: string;
  productName: string;
  sku: string;
  size: string | null;
  colour: string | null;
  quantity: number;
  /** As sent by the server with the scan. A preview input, not an authority. */
  unitPriceMinor: number;
  taxRateBp: number;
  stockQuantity: number | null;
}

export interface BillState {
  lines: BillLine[];
  customer: CustomerHit | null;
  /**
   * One key per bill, reused for every attempt at that bill. Regenerated only when the bill
   * is cleared, which is what makes a double click, an impatient retry and a flaky connection
   * all resolve to the same sale rather than to several.
   */
  idempotencyKey: string;
}

export type BillAction =
  | { type: "scanned"; item: ScannedItem }
  | { type: "picked"; item: CatalogItem }
  | { type: "quantity_set"; variantId: string; quantity: number }
  | { type: "quantity_step"; variantId: string; by: number }
  | { type: "line_removed"; variantId: string }
  | { type: "customer_attached"; customer: CustomerHit }
  | { type: "customer_cleared" }
  /** After a completed sale, or an explicit abandon. Takes a fresh idempotency key. */
  | { type: "cleared"; idempotencyKey: string };

export function emptyBill(idempotencyKey: string): BillState {
  return { lines: [], customer: null, idempotencyKey };
}

/**
 * A fresh key per bill. `crypto.randomUUID` where it exists; the fallback matters because the
 * key's job is only to be unique within one tenant, and a timestamp plus randomness satisfies
 * that without pretending to be cryptographic.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `bill-${crypto.randomUUID()}`;
  }
  return `bill-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function toLine(item: CatalogItem, quantity: number): BillLine {
  return {
    variantId: item.variantId,
    productName: item.productName,
    sku: item.sku,
    size: item.size,
    colour: item.colour,
    quantity,
    unitPriceMinor: item.priceMinor,
    taxRateBp: item.taxRateBp,
    stockQuantity: item.stockQuantity,
  };
}

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1;
  const whole = Math.trunc(quantity);
  if (whole < 1) return 1;
  if (whole > MAX_LINE_QUANTITY) return MAX_LINE_QUANTITY;
  return whole;
}

function addOrIncrement(state: BillState, item: CatalogItem): BillState {
  const existing = state.lines.findIndex((line) => line.variantId === item.variantId);

  // The second scan of the same barcode is the same line with one more on it, not a second
  // line. A counter scanning three identical items should see "x3", not three rows to read.
  if (existing >= 0) {
    const lines = state.lines.slice();
    const line = lines[existing]!;
    lines[existing] = { ...line, quantity: clampQuantity(line.quantity + 1) };
    return { ...state, lines };
  }

  // Refused rather than silently truncated: a bill that quietly stopped accepting items is
  // the worst possible failure at a till.
  if (state.lines.length >= MAX_LINES_PER_SALE) return state;

  return { ...state, lines: [...state.lines, toLine(item, 1)] };
}

export function billReducer(state: BillState, action: BillAction): BillState {
  switch (action.type) {
    case "scanned":
      // A withdrawn item never reaches the bill. The caller is expected to have classified
      // the scan, but enforcing it here too means no future caller can add one by mistake.
      if (!action.item.isActive) return state;
      return addOrIncrement(state, action.item);

    case "picked":
      return addOrIncrement(state, action.item);

    case "quantity_set": {
      if (validateQuantity(action.quantity) !== null) {
        const clamped = clampQuantity(action.quantity);
        return {
          ...state,
          lines: state.lines.map((line) =>
            line.variantId === action.variantId ? { ...line, quantity: clamped } : line,
          ),
        };
      }
      return {
        ...state,
        lines: state.lines.map((line) =>
          line.variantId === action.variantId ? { ...line, quantity: action.quantity } : line,
        ),
      };
    }

    case "quantity_step": {
      const line = state.lines.find((l) => l.variantId === action.variantId);
      if (!line) return state;
      const next = line.quantity + action.by;
      // Stepping below one removes the line, which is what a cashier pressing "−" on a single
      // item means. It is not the same as setting a quantity of zero, which is nonsense.
      if (next < 1) {
        return { ...state, lines: state.lines.filter((l) => l.variantId !== action.variantId) };
      }
      return {
        ...state,
        lines: state.lines.map((l) =>
          l.variantId === action.variantId ? { ...l, quantity: clampQuantity(next) } : l,
        ),
      };
    }

    case "line_removed":
      return { ...state, lines: state.lines.filter((l) => l.variantId !== action.variantId) };

    case "customer_attached":
      return { ...state, customer: action.customer };

    case "customer_cleared":
      return { ...state, customer: null };

    case "cleared":
      return emptyBill(action.idempotencyKey);
  }
}

/** The preview. Same function the server uses, from prices the server sent. */
export function billTotals(state: BillState): SaleTotals {
  return computeSaleTotals(
    state.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      taxRateBp: line.taxRateBp,
    })),
  );
}

/** Exactly what `POST /sales` accepts from a client: what, and how paid. No money. */
export function billLinesForSubmission(state: BillState): { variantId: string; quantity: number }[] {
  return state.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity }));
}

export function billItemCount(state: BillState): number {
  return state.lines.reduce((sum, line) => sum + line.quantity, 0);
}

export { MAX_LINES_PER_SALE, MAX_LINE_QUANTITY };
