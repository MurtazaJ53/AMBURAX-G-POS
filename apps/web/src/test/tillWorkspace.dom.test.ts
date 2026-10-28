// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createElement, forwardRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// The till workspace is a client component. Its panels are stubbed so these tests cover only
// what the workspace itself owns: where keyboard focus goes.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("lucide-react", () => ({ Lock: () => null, UserRound: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/till/_components/StatusRail", () => ({ StatusRail: () => null }));
vi.mock("@/app/(app)/till/_components/OperatorBar", () => ({ OperatorBar: () => null }));
vi.mock("@/app/(app)/till/_components/SessionPanel", () => ({ SessionPanel: () => null }));
vi.mock("@/app/(app)/till/_components/PaymentPanel", () => ({ PaymentPanel: () => null }));
vi.mock("@/app/(app)/till/_components/CompletionPanel", () => ({ CompletionPanel: () => null }));
vi.mock("@/app/(app)/till/_components/BillPanel", async () => {
  const { createElement: h } = await import("react");
  return { BillPanel: () => h("button", { type: "button", id: "bill-line" }, "line") };
});
vi.mock("@/app/(app)/till/_components/CustomerPanel", async () => {
  const React = await import("react");
  return {
    CustomerPanel: React.forwardRef<HTMLInputElement>((_p, ref) =>
      React.createElement("input", { id: "customer", ref }),
    ),
  };
});

const tillState = {
  session: { phase: "active" },
  completion: { phase: "idle" },
  bill: { customer: null, lines: [] },
  totals: {},
  scan: null,
  scanning: false,
  devices: { phase: "ready", devices: [], error: null },
  selectedDevice: null,
  submitScan: vi.fn(),
  pickItem: vi.fn(),
  clearScan: vi.fn(),
  startNewBill: vi.fn(),
  takePayment: vi.fn(),
  dispatchBill: vi.fn(),
};
vi.mock("@/app/(app)/till/_components/useTill", () => ({ useTill: () => tillState }));
vi.mock("@/client/pos/bill", () => ({ billItemCount: () => 0 }));

void forwardRef;
const { TillWorkspace } = await import("@/app/(app)/till/_components/TillWorkspace");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      createElement(TillWorkspace, {
        currentUserId: "u1",
        cashierName: "E2E Cashier",
        roleLabel: "Cashier",
        storeName: "E2E Store",
        storeCode: "E2E",
        gstRegistered: true,
      }),
    );
  });
}

const scanField = () => container.querySelector<HTMLInputElement>("#till-scan")!;

describe("till keyboard focus (bug 4)", () => {
  it("puts focus in the scan field on load", async () => {
    await render();
    expect(document.activeElement).toBe(scanField());
  });

  it("sends a scanner's keystrokes to the scan field when focus has wandered off it", async () => {
    await render();
    const line = container.querySelector<HTMLButtonElement>("#bill-line")!;
    line.focus();
    expect(document.activeElement).toBe(line);
    await act(async () => {
      line.dispatchEvent(new KeyboardEvent("keydown", { key: "8", bubbles: true }));
    });
    expect(document.activeElement).toBe(scanField());
  });

  it("does not steal keystrokes typed into another field", async () => {
    await render();
    const customer = container.querySelector<HTMLInputElement>("#customer")!;
    customer.focus();
    await act(async () => {
      customer.dispatchEvent(new KeyboardEvent("keydown", { key: "9", bubbles: true }));
    });
    expect(document.activeElement).toBe(customer);
  });

  it("offers a skip link to the scan field", async () => {
    await render();
    const skip = container.querySelector<HTMLAnchorElement>('a[href="#till-scan"]');
    expect(skip?.textContent).toMatch(/skip to scan/i);
  });
});
