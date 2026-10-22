import { describe, it, expect } from "vitest";
import {
  ORDER_TRANSITIONS,
  OrderStatus,
  canCancel,
  canTransition,
  deriveFulfilmentStatus,
  isEditable,
  isTerminal,
} from "@/server/orders/orderStatus";

/**
 * The transition matrix, asserted exhaustively rather than by example. Every ordered pair of
 * statuses is either legal or it is not, and this file enumerates all of them — so adding a
 * status without deciding what may reach it fails here rather than in production.
 */

const ALL: OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.CONFIRMED,
  OrderStatus.RESERVED,
  OrderStatus.PARTIALLY_FULFILLED,
  OrderStatus.FULFILLED,
  OrderStatus.CLOSED,
  OrderStatus.CANCELLED,
];

/** The legal edges, written out by hand so the matrix is checked against intent, not itself. */
const LEGAL: ReadonlyArray<[OrderStatus, OrderStatus]> = [
  [OrderStatus.DRAFT, OrderStatus.CONFIRMED],
  [OrderStatus.DRAFT, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED, OrderStatus.PARTIALLY_FULFILLED],
  [OrderStatus.CONFIRMED, OrderStatus.FULFILLED],
  [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  // Decision 36 (2026-10-14): a confirmed order may reserve its stock through the ledger.
  [OrderStatus.CONFIRMED, OrderStatus.RESERVED],
  [OrderStatus.RESERVED, OrderStatus.PARTIALLY_FULFILLED],
  [OrderStatus.RESERVED, OrderStatus.FULFILLED],
  [OrderStatus.RESERVED, OrderStatus.CANCELLED],
  [OrderStatus.PARTIALLY_FULFILLED, OrderStatus.PARTIALLY_FULFILLED],
  [OrderStatus.PARTIALLY_FULFILLED, OrderStatus.FULFILLED],
  [OrderStatus.FULFILLED, OrderStatus.CLOSED],
];

function isLegal(from: OrderStatus, to: OrderStatus): boolean {
  return LEGAL.some(([f, t]) => f === from && t === to);
}

describe("the order transition matrix", () => {
  it("permits exactly the legal edges and refuses every other pair", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        expect(canTransition(from, to)).toBe(isLegal(from, to));
      }
    }
  });

  it("covers every status, so no state is missing a rule", () => {
    for (const status of ALL) {
      expect(ORDER_TRANSITIONS[status]).toBeDefined();
    }
    expect(Object.keys(ORDER_TRANSITIONS)).toHaveLength(ALL.length);
  });
});

describe("RESERVED", () => {
  // Backed by the reservation ledger (inventory/reservations.ts): only a confirmed order reaches it.
  it("is reachable only from CONFIRMED", () => {
    for (const from of ALL) {
      expect(canTransition(from, OrderStatus.RESERVED)).toBe(from === OrderStatus.CONFIRMED);
    }
  });
});

describe("terminal states", () => {
  it("are CLOSED and CANCELLED", () => {
    expect(isTerminal(OrderStatus.CLOSED)).toBe(true);
    expect(isTerminal(OrderStatus.CANCELLED)).toBe(true);
  });

  it("are nothing else", () => {
    for (const status of [
      OrderStatus.DRAFT,
      OrderStatus.CONFIRMED,
      OrderStatus.RESERVED,
      OrderStatus.PARTIALLY_FULFILLED,
      OrderStatus.FULFILLED,
    ]) {
      expect(isTerminal(status)).toBe(false);
    }
  });

  it("lead nowhere", () => {
    expect(ORDER_TRANSITIONS[OrderStatus.CLOSED]).toHaveLength(0);
    expect(ORDER_TRANSITIONS[OrderStatus.CANCELLED]).toHaveLength(0);
  });
});

describe("editability", () => {
  /** A confirmed order is a commitment; a commitment that can be quietly rewritten is not one. */
  it("is a draft-only privilege", () => {
    expect(isEditable(OrderStatus.DRAFT)).toBe(true);
    for (const status of ALL.filter((s) => s !== OrderStatus.DRAFT)) {
      expect(isEditable(status)).toBe(false);
    }
  });
});

describe("cancellation", () => {
  it("is allowed from DRAFT and CONFIRMED", () => {
    expect(canCancel(OrderStatus.DRAFT)).toBe(true);
    expect(canCancel(OrderStatus.CONFIRMED)).toBe(true);
  });

  /**
   * Refused once anything has been delivered. Cancelling a half-delivered order would mean
   * cancelling the remainder, which changes outstanding quantities rather than the document's
   * fate — a different operation on data this phase does not carry.
   */
  it("is refused once the order is partially fulfilled or beyond", () => {
    expect(canCancel(OrderStatus.PARTIALLY_FULFILLED)).toBe(false);
    expect(canCancel(OrderStatus.FULFILLED)).toBe(false);
    expect(canCancel(OrderStatus.CLOSED)).toBe(false);
    expect(canCancel(OrderStatus.CANCELLED)).toBe(false);
  });
});

describe("status derived from fulfilled quantities", () => {
  it("stays put when nothing has been fulfilled", () => {
    const lines = [
      { quantity: 5, fulfilledQuantity: 0 },
      { quantity: 3, fulfilledQuantity: 0 },
    ];
    expect(deriveFulfilmentStatus(OrderStatus.CONFIRMED, lines)).toBe(OrderStatus.CONFIRMED);
  });

  it("is PARTIALLY_FULFILLED when some of one line is met", () => {
    const lines = [
      { quantity: 5, fulfilledQuantity: 2 },
      { quantity: 3, fulfilledQuantity: 0 },
    ];
    expect(deriveFulfilmentStatus(OrderStatus.CONFIRMED, lines)).toBe(
      OrderStatus.PARTIALLY_FULFILLED,
    );
  });

  it("is PARTIALLY_FULFILLED when one whole line is met but another is not", () => {
    const lines = [
      { quantity: 5, fulfilledQuantity: 5 },
      { quantity: 3, fulfilledQuantity: 0 },
    ];
    expect(deriveFulfilmentStatus(OrderStatus.CONFIRMED, lines)).toBe(
      OrderStatus.PARTIALLY_FULFILLED,
    );
  });

  it("is FULFILLED only when every line is met", () => {
    const lines = [
      { quantity: 5, fulfilledQuantity: 5 },
      { quantity: 3, fulfilledQuantity: 3 },
    ];
    expect(deriveFulfilmentStatus(OrderStatus.CONFIRMED, lines)).toBe(OrderStatus.FULFILLED);
  });

  it("returns the current status for an order with no lines rather than calling it fulfilled", () => {
    expect(deriveFulfilmentStatus(OrderStatus.DRAFT, [])).toBe(OrderStatus.DRAFT);
  });
});
