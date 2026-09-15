import { vi } from "vitest";

/**
 * A stand-in for the v1 API.
 *
 * Deliberately envelope-accurate rather than convenient. Every reply built here has the exact
 * shape the real routes return — `{ status: "ok", ... }` for success and
 * `{ error: { code, message }, correlationId }` for a refusal, with the status code the route
 * actually uses. A stub that returned a friendlier shape would let the till pass its tests
 * while failing against the server it was written for.
 */

export interface StubRoute {
  /** Matched as a prefix against the request URL, so query strings need not be spelled out. */
  path: string;
  method?: "GET" | "POST";
  /** Replies in order; the last reply repeats once the list is exhausted. */
  replies: StubReply[];
}

export type StubReply =
  | { kind: "ok"; status?: number; body: Record<string, unknown> }
  | { kind: "error"; status: number; code: string; message: string }
  /** The request never lands — the outcome is genuinely unknown to the caller. */
  | { kind: "offline" };

export interface ApiStub {
  /** One entry per call, in order, for asserting what the till actually sent. */
  calls: { url: string; method: string; body: unknown }[];
  /** How many times a path prefix was called — the duplicate-submission assertion. */
  countFor(path: string): number;
}

export function stubApi(routes: StubRoute[]): ApiStub {
  const cursors = new Map<StubRoute, number>();
  const stub: ApiStub = {
    calls: [],
    countFor(path) {
      return stub.calls.filter((call) => call.url.startsWith(path)).length;
    },
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      stub.calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      const route = routes.find(
        (candidate) =>
          url.startsWith(candidate.path) && (candidate.method ?? "GET") === method,
      );
      if (!route) {
        throw new Error(`No stub for ${method} ${url}`);
      }

      const index = cursors.get(route) ?? 0;
      const reply = route.replies[Math.min(index, route.replies.length - 1)]!;
      cursors.set(route, index + 1);

      if (reply.kind === "offline") {
        // What a dropped connection looks like to `fetch`: a rejection, not a response.
        throw new TypeError("Failed to fetch");
      }

      if (reply.kind === "error") {
        return new Response(
          JSON.stringify({
            error: { code: reply.code, message: reply.message },
            correlationId: "cid-test",
          }),
          { status: reply.status, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ status: "ok", ...reply.body, correlationId: "cid-test" }),
        { status: reply.status ?? 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );

  return stub;
}

/* ------------------------------------------------------------------ fixtures */

export const DEVICE = {
  id: "dev-1",
  name: "Front counter",
  code: "POS-01",
  storeId: "store-1",
  status: "ACTIVE" as const,
  activeSessionId: null,
  lastSeenAt: null,
  scanSoundEnabled: true,
  showProductImages: true,
};

export const SESSION = {
  id: "sess-1",
  storeId: "store-1",
  posDeviceId: "dev-1",
  cashierUserId: "user-me",
  openedAt: "2026-09-15T09:00:00.000Z",
  closedAt: null,
  closingNote: null,
  isOpen: true,
};

export const SHIRT = {
  variantId: "var-1",
  productName: "Cotton Shirt",
  sku: "SHIRT-M-BLUE",
  barcode: "8901234567890",
  size: "M",
  colour: "Blue",
  priceMinor: 10000,
  taxRateBp: 500,
  stockQuantity: 4,
  isActive: true,
};

export const SALE = {
  id: "sale-1",
  billNumber: "B-0001",
  totalMinor: 10000,
  subtotalMinor: 9524,
  taxMinor: 476,
  discountMinor: 0,
  paidMinor: 10000,
  paymentStatus: "PAID",
  erpSyncStatus: "PENDING",
  completedAt: "2026-09-15T10:00:00.000Z",
};

/** The two reads the till performs on mount, answered the ordinary way. */
export function readyTillRoutes(extra: StubRoute[] = []): StubRoute[] {
  return [
    { path: "/api/v1/pos/devices", replies: [{ kind: "ok", body: { devices: [DEVICE] } }] },
    { path: "/api/v1/pos/sessions", replies: [{ kind: "ok", body: { session: SESSION } }] },
    ...extra,
  ];
}
