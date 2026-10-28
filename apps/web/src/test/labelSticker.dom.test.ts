// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// lucide-react is hoisted to the repo root and resolves another React copy; stub the icons.
vi.mock("lucide-react", () => {
  const icon = () => null;
  return Object.fromEntries(["AlertTriangle", "Barcode", "Printer", "X", "Plus", "Minus"].map((n) => [n, icon]));
});

const { LabelSticker } = await import("@/app/(app)/products/[id]/BarcodeLabelModal");
const { LABEL_SIZES, layoutLabelBarcode } = await import("@/client/hardware/labelLayout");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** The printed label's price line, as text, plus whether anything on it is struck through. */
async function priceLine(priceMinor: number, mrpMinor: number | null) {
  const size = LABEL_SIZES["roll-50x25"];
  const layout = layoutLabelBarcode("2100000000012", size, 203);
  if (!layout.ok) throw new Error(layout.reason);
  await act(async () => {
    root.render(
      createElement(LabelSticker, {
        item: { id: "v1", sku: "S1", barcode: "2100000000012", productName: "Socks", size: null, colour: null, priceMinor, mrpMinor },
        code: "2100000000012",
        layout,
        size,
        includeStoreName: false,
        includeMrp: true,
      }),
    );
  });
  const label = container.querySelector(".amb-label") as HTMLElement;
  const line = label.lastElementChild as HTMLElement;
  const struck = Array.from(line.querySelectorAll("*")).some((el) => (el as HTMLElement).style.textDecoration.includes("line-through"));
  return { text: line.textContent!.replace(/\s+/g, " ").trim(), struck };
}

describe("label price line", () => {
  it("bug 10: a variant with no MRP prints its price without the word MRP", async () => {
    const { text } = await priceLine(14900, null);
    expect(text).toContain("₹149");
    expect(text).not.toMatch(/MRP/);
  });

  it("bug 11: an MRP is always followed by (incl. of all taxes)", async () => {
    for (const [price, mrp] of [[119900, 149900], [149900, 149900]] as const) {
      const { text } = await priceLine(price, mrp);
      expect(text).toMatch(/MRP ₹1499 \(incl\. of all taxes\)/);
    }
  });

  it("bug 11: no tax wording without an MRP", async () => {
    const { text } = await priceLine(14900, null);
    expect(text).not.toMatch(/taxes/);
  });
});
