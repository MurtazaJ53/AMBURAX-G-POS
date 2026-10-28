// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// The wizard is a client component. These tests render it into jsdom with its heavy children
// (image picker, camera scanner, label modal) stubbed out, and drive it the way a person would.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// lucide-react is hoisted to the repo root, where it resolves a different React copy; its
// elements would be rejected by this React, so icons render as nothing here.
vi.mock("lucide-react", () => {
  const icon = () => null;
  const names = [
    "Check", "ChevronRight", "ChevronLeft", "Sparkles", "Layers", "Percent", "Barcode", "Building2", "Tag",
    "AlertCircle", "Plus", "Trash2", "Camera", "Printer", "Package", "RotateCcw", "ExternalLink", "AlertTriangle",
  ];
  return Object.fromEntries(names.map((n) => [n, icon]));
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/products/_components/ProductImagePicker", () => ({ ProductImagePicker: () => null }));
vi.mock("@/client/hardware/CameraBarcodeScannerModal", () => ({ CameraBarcodeScannerModal: () => null }));
vi.mock("@/app/(app)/products/[id]/BarcodeLabelModal", () => ({ BarcodeLabelModal: () => null }));

const { AddProductWizard } = await import("@/app/(app)/products/new/AddProductWizard");

type Props = Parameters<typeof AddProductWizard>[0];

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    uoms: [{ id: "uom-pcs", name: "Pieces", code: "PCS" }],
    stores: [{ id: "store-1", name: "Main", code: "MAIN", storeType: "RETAIL", isDefault: true }],
    attributeDefinitions: [],
    sizeGroups: [{ id: "g1", name: "Alpha", code: "ALPHA", sizes: [{ id: "s1", name: "M", code: "M" }] }],
    ...overrides,
  } as Props;
}

let container: HTMLDivElement;
let root: Root;

export async function render(props: Props) {
  await act(async () => {
    root.render(createElement(AddProductWizard, props));
  });
}

export function buttonByText(re: RegExp): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll("button")).find((x) => re.test(x.textContent ?? ""));
  if (!b) throw new Error(`no button matching ${re}`);
  return b as HTMLButtonElement;
}

export async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export async function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ matches: [] }), { status: 200 })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function inputByPlaceholder(ph: string): HTMLInputElement {
  const el = container.querySelector(`input[placeholder="${ph}"]`);
  if (!el) throw new Error(`no input with placeholder ${ph}`);
  return el as HTMLInputElement;
}

/** Walk the wizard from step 1 to the review step with one priced variant. */
async function goToReview(props: Props) {
  await render(props);
  await typeInto(inputByPlaceholder("e.g. Slim Fit Denim Cotton Shirt"), "Linen Shirt");
  await click(buttonByText(/^Next: Tax/));
  await click(buttonByText(/^Next: Size/));
  await click(buttonByText(/^Generate Variant Grid/));
  await typeInto(inputByPlaceholder("e.g. 1199"), "499");
  await click(buttonByText(/^Apply$/));
  await click(buttonByText(/^Next: Wholesale/));
}

function respondToSave(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify(body), { status });
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
}

describe("AddProductWizard", () => {
  it("renders step 1", async () => {
    await render(baseProps());
    expect(container.textContent).toContain("Product Essentials");
  });

  describe("bug 7: a refused save", () => {
    for (const [status, message] of [
      [400, "Base unit of measure is required."],
      [422, "Check the tax treatment, rate, and statutory reference."],
    ] as const) {
      it(`shows the server's ${status} message beside the save button and re-enables it`, async () => {
        await goToReview(baseProps());
        respondToSave(status, { error: { code: "validation_error", message } });
        const save = buttonByText(/Save Product/);
        await click(save);
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
        const button = buttonByText(/Save Product|Creating Variants/);
        expect(button.textContent).toMatch(/Save Product/);
        expect(button.disabled).toBe(false);
        // The message must be next to the button the person just pressed, not scrolled off at
        // the top of a long page.
        const alert = button.parentElement!.parentElement!.querySelector('[role="alert"]');
        expect(alert?.textContent).toContain(message);
      });
    }
  });

  describe("bug 1: a business with no unit of measure", () => {
    it("offers to add Pieces (PCS) and selects it once created", async () => {
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/v1/uoms" && init?.method === "POST") {
          return new Response(
            JSON.stringify({ status: "ok", uom: { id: "uom-new", code: "PCS", name: "Pieces" }, existing: false }),
            { status: 201 },
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);
      await render(baseProps({ uoms: [] }));

      await click(buttonByText(/Add Pieces \(PCS\)/));

      const post = fetchMock.mock.calls.find(([u, i]) => u === "/api/v1/uoms" && i?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(String(post![1]!.body))).toMatchObject({ code: "PCS", name: "Pieces" });
      const select = container.querySelector("select") as HTMLSelectElement;
      expect(select.value).toBe("uom-new");
      expect(select.textContent).toContain("Pieces (PCS)");
    });
  });

  describe("bug 8: a shop without a GSTIN", () => {
    it("is not offered GST, and saves its products as non-GST", async () => {
      await goToReview(baseProps({ gstRegistered: false }));
      respondToSave(201, { productId: "p1", variants: [] });
      await click(buttonByText(/Save Product/));
      const fetchMock = vi.mocked(fetch);
      const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST");
      const body = JSON.parse(String(post![1]!.body));
      expect(body.hsnCode).toBeNull();
      for (const v of body.variants) {
        expect(v.taxTreatment).toBe("NON_GST");
        expect(v.taxRateBp).toBe(0);
      }
    });

    it("shows no GST switch on the tax step", async () => {
      await render(baseProps({ gstRegistered: false }));
      await typeInto(inputByPlaceholder("e.g. Slim Fit Denim Cotton Shirt"), "Linen Shirt");
      await click(buttonByText(/^Next: Tax/));
      expect(container.querySelector("#gstApplicable")).toBeNull();
      expect(container.textContent).toMatch(/no GSTIN/i);
    });

    it("a GST-registered shop still gets GST on by default", async () => {
      await render(baseProps({ gstRegistered: true }));
      await typeInto(inputByPlaceholder("e.g. Slim Fit Denim Cotton Shirt"), "Linen Shirt");
      await click(buttonByText(/^Next: Tax/));
      expect((container.querySelector("#gstApplicable") as HTMLInputElement).checked).toBe(true);
    });
  });

  describe("bug 21: HSN code", () => {
    it("is not silently prefilled with the knitted T-shirt code", async () => {
      await render(baseProps({ gstRegistered: true }));
      await typeInto(inputByPlaceholder("e.g. Slim Fit Denim Cotton Shirt"), "Linen Shirt");
      await click(buttonByText(/^Next: Tax/));
      expect(inputByPlaceholder("e.g. 61091000").value).toBe("");
    });
  });
});
