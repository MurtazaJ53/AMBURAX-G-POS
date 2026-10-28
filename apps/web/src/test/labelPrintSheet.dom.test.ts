// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("lucide-react", () => {
  const icon = () => null;
  return Object.fromEntries(["AlertTriangle", "Barcode", "Printer", "X", "Plus", "Minus"].map((n) => [n, icon]));
});

const { BarcodeLabelModal } = await import("@/app/(app)/products/[id]/BarcodeLabelModal");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const mm = (v: string) => {
  const m = /^([\d.]+)mm$/.exec(v);
  if (!m) throw new Error(`not a mm length: ${v}`);
  return Number(m[1]);
};

describe("bug 20: A4 65-up print sheet", () => {
  it("each sheet's box is shorter than the A4 page, so it never spills a blank page", async () => {
    localStorage.setItem("amb.labelPrinter", JSON.stringify({ sizeId: "a4-65", dpi: 203 }));
    await act(async () => {
      root.render(
        createElement(BarcodeLabelModal, {
          isOpen: true,
          onClose: () => {},
          variants: [
            { id: "v1", sku: "S1", barcode: "2100000000012", productName: "Shirt", size: "M", colour: null, priceMinor: 99900, quantity: 70 },
          ],
        }),
      );
    });
    const pages = Array.from(document.querySelectorAll(".amb-label-print-root .amb-label-page")) as HTMLElement[];
    expect(pages).toHaveLength(2);
    const pageRule = document.querySelector(".amb-label-print-root style")!.textContent!;
    const pageHeightMm = Number(/size: [\d.]+mm ([\d.]+)mm/.exec(pageRule)![1]);
    for (const page of pages) {
      // Exactly the page height rounds up past it in the browser's px layout, and with
      // break-after the overflow becomes a blank page after every sheet.
      expect(mm(page.style.height)).toBeLessThan(pageHeightMm);
      // ...but still tall enough for all 13 rows below the top margin.
      expect(mm(page.style.height)).toBeGreaterThanOrEqual(10.7 + 13 * 21.2);
    }
  });
});
