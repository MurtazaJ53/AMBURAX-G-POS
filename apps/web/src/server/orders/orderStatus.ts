import { OrderStatus } from "@prisma/client";

export { OrderStatus };

/**
 * What an order may become next, and why. Pure — no database, no session, no clock.
 *
 * ## The matrix
 *
 *     DRAFT               -> CONFIRMED, CANCELLED
 *     CONFIRMED           -> PARTIALLY_FULFILLED, FULFILLED, CANCELLED
 *     PARTIALLY_FULFILLED -> PARTIALLY_FULFILLED, FULFILLED
 *     FULFILLED           -> CLOSED
 *     CLOSED              -> nothing
 *     CANCELLED           -> nothing
 *     RESERVED            -> unreachable; see below
 *
 * ## RESERVED is unreachable, on purpose
 *
 * The approved lifecycle names RESERVED between CONFIRMED and fulfilment, so the enum carries
 * it. Nothing can reach it.
 *
 * There is no reservation accounting anywhere in this system. `StockMovementType` has no
 * RESERVATION member; `StockLevel` is a plain projection of the movement ledger's running sum;
 * no column records committed-but-unshipped quantity. An order whose status read RESERVED would
 * therefore assert that stock is set aside when nothing has set anything aside, and the next
 * person to trust it would be a picker finding an empty shelf.
 *
 * The honest options were to build reservation accounting (a ledger change, large and out of
 * scope) or to leave the state unreachable and say so. This is the second. When a reservation
 * foundation exists, CONFIRMED -> RESERVED -> fulfilment becomes reachable by adding edges here.
 *
 * ## Why cancellation stops at CONFIRMED
 *
 * A partially fulfilled order has had some of its demand met. Cancelling it would have to mean
 * "cancel the remainder", which is a different operation from "cancel the order" — it changes
 * outstanding quantities rather than the document's fate, and doing it properly needs a per-line
 * cancelled quantity this phase does not have. Refusing is the truthful answer; silently
 * cancelling an order that was half delivered is not.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.DRAFT]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [
    OrderStatus.PARTIALLY_FULFILLED,
    OrderStatus.FULFILLED,
    OrderStatus.CANCELLED,
  ],
  // Reachable only if a future phase adds the edges into it. Listed so the matrix stays total.
  [OrderStatus.RESERVED]: [],
  [OrderStatus.PARTIALLY_FULFILLED]: [OrderStatus.PARTIALLY_FULFILLED, OrderStatus.FULFILLED],
  [OrderStatus.FULFILLED]: [OrderStatus.CLOSED],
  [OrderStatus.CLOSED]: [],
  [OrderStatus.CANCELLED]: [],
} as const;

/** Terminal states. Nothing about an order in one of these may change again. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  OrderStatus.CLOSED,
  OrderStatus.CANCELLED,
] as const;

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Only a DRAFT may have its lines or its customer changed. Everything later is a commitment. */
export function isEditable(status: OrderStatus): boolean {
  return status === OrderStatus.DRAFT;
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** The states an order may be cancelled from. Derived from the matrix, never a second list. */
export function canCancel(status: OrderStatus): boolean {
  return canTransition(status, OrderStatus.CANCELLED);
}

/**
 * The status implied by how much of the order has actually been fulfilled.
 *
 * Status is derived from recorded quantities, never set from a client-supplied string. That is
 * the whole reason `OrderItem.fulfilledQuantity` exists: "partially fulfilled" has to be a fact
 * about lines, not a label someone typed.
 *
 * `current` comes back unchanged when nothing has been fulfilled yet, so a CONFIRMED order with
 * no deliveries stays CONFIRMED rather than being dragged forwards.
 */
export function deriveFulfilmentStatus(
  current: OrderStatus,
  lines: readonly { quantity: number; fulfilledQuantity: number }[],
): OrderStatus {
  if (lines.length === 0) return current;

  const anyFulfilled = lines.some((line) => line.fulfilledQuantity > 0);
  const allFulfilled = lines.every((line) => line.fulfilledQuantity >= line.quantity);

  if (allFulfilled) return OrderStatus.FULFILLED;
  if (anyFulfilled) return OrderStatus.PARTIALLY_FULFILLED;
  return current;
}
