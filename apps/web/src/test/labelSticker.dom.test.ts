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
const { LABEL_SIZES, labelOriginPx, layoutLabelBarcode } = await import("@/client/hardware/labelLayout");

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

  it("bug 37: a discounted item shows the MRP plainly, never struck through", async () => {
    const { text, struck } = await priceLine(119900, 149900);
    expect(struck).toBe(false);
    expect(text).toContain("MRP ₹1499");
    expect(text).toContain("₹1199");
  });
});

describe("bug 12: every bar edge lands on a whole printer dot", () => {
  for (const sizeId of ["roll-38x25", "roll-50x25", "a4-65"] as const) {
    for (const dpi of [203, 300] as const) {
      for (const code of ["2100000000067", "2100000000098", "2100000000012"]) {
        it(`${sizeId} at ${dpi} dpi, ${code}`, async () => {
          const size = LABEL_SIZES[sizeId];
          const layout = layoutLabelBarcode(code, size, dpi);
          if (!layout.ok) throw new Error(layout.reason);
          const columns = size.sheet ? size.sheet.columns : 1;
          for (let col = 0; col < columns; col++) {
            const originXPx = labelOriginPx(size, col).x;
            expect(Number.isInteger(originXPx)).toBe(true);
            await act(async () => {
              root.render(
                createElement(LabelSticker, {
                  item: { id: "v1", sku: "S1", barcode: code, productName: "Linen", size: "M", colour: null, priceMinor: 99900 },
                  code,
                  layout,
                  size,
                  includeStoreName: false,
                  includeMrp: true,
                  originXPx,
                }),
              );
            });
            const svg = container.querySelector("svg") as SVGSVGElement;
            // The box sits at a whole px inside a label edge that is itself at a whole px, so the
            // browser has nothing to round; its user unit is exactly one printer dot.
            expect(svg.style.left).toMatch(/^\d+px$/);
            expect(svg.style.width).toMatch(/^\d+px$/);
            const leftPx = parseFloat(svg.style.left);
            const widthPx = parseFloat(svg.style.width);
            const viewDots = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
            expect(viewDots / widthPx).toBeCloseTo(dpi / 96, 9);
            const shift = Number(/translate\(([\d.e-]+)/.exec(svg.querySelector("g")!.getAttribute("transform")!)![1]);
            const boxLeftDots = ((originXPx + leftPx) * dpi) / 96;
            const rects = Array.from(svg.querySelectorAll("rect"));
            expect(rects.length).toBeGreaterThan(20);
            const perModule = dpi === 300 ? 3 : 2;
            for (const r of rects) {
              const x = Number(r.getAttribute("x"));
              const w = Number(r.getAttribute("width"));
              const start = boxLeftDots + shift + x;
              expect(Math.abs(start - Math.round(start))).toBeLessThan(1e-6);
              expect(w % perModule).toBe(0);
              expect(x + w).toBeLessThanOrEqual(viewDots - shift);
            }
            // Still centred to within a px.
            const centredPx = (((size.widthMm - layout.totalWidthMm) / 2) * 96) / 25.4;
            expect(Math.abs(leftPx - centredPx)).toBeLessThanOrEqual(0.5);
          }
        });
      }
    }
  }
});
