import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { findInspectorInvoker, restoreInspectorFocus } from "@/components/inventory/inspectorFocus";
import { InventoryDetailPanel } from "@/components/inventory/InventoryDetailPanel";

/**
 * Inventory Part 4 — closing the product inspector hands focus back to the product that opened
 * it, and never to <body> or to a detached node.
 */

vi.mock("lucide-react", () => {
  const Icon = () => <svg data-testid="icon" />;
  return { X: Icon, Package: Icon };
});

const href = (sku: string) => `/inventory?${new URLSearchParams({ status: "in_stock", selected: sku })}`;

function item(sku: string) {
  return {
    id: `sl-${sku}`,
    tenantId: "t",
    storeId: "s",
    variantId: `v-${sku}`,
    quantity: 27,
    updatedAt: new Date("2026-10-05T04:30:00.000Z"),
    variant: {
      id: `v-${sku}`,
      sku,
      priceMinor: 129900,
      size: null,
      colour: null,
      product: { id: `p-${sku}`, name: `Product ${sku}`, category: "Trousers", brand: "Amburax", imageUrl: null },
    },
  } as unknown as Parameters<typeof InventoryDetailPanel>[0]["item"];
}

/** The page in miniature: a heading, the product links, and the panel when one is selected. */
function Page({ skus, selected }: { skus: string[]; selected?: string }) {
  return (
    <main>
      <h1>Inventory</h1>
      <ul>
        {skus.map((sku) => (
          <li key={sku}>
            <a href={href(sku)}>{sku}</a>
          </li>
        ))}
      </ul>
      {selected ? <InventoryDetailPanel item={item(selected)} closeHref="/inventory?status=in_stock" canManage /> : null}
    </main>
  );
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const show = (ui: React.ReactElement) => act(() => root.render(ui));
const nextFrame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
const link = (sku: string) => [...document.querySelectorAll("a")].find((a) => a.textContent === sku)!;

describe("findInspectorInvoker", () => {
  test("matches the exact SKU in the selected parameter, not a prefix", () => {
    document.body.innerHTML = `<a href="${href("A-10")}">A-10</a><a href="${href("A-1")}">A-1</a>`;
    expect(findInspectorInvoker(document, "A-1")?.textContent).toBe("A-1");
    expect(findInspectorInvoker(document, "A-10")?.textContent).toBe("A-10");
    expect(findInspectorInvoker(document, "A")).toBeNull();
  });

  test("decodes SKUs that the query string had to encode", () => {
    document.body.innerHTML = `<a href="${href("TEE M/L #2")}">tee</a>`;
    expect(findInspectorInvoker(document, "TEE M/L #2")?.textContent).toBe("tee");
  });

  test("ignores links inside a dialog", () => {
    document.body.innerHTML = `<div role="dialog"><a href="${href("A-1")}">inner</a></div>`;
    expect(findInspectorInvoker(document, "A-1")).toBeNull();
  });
});

describe("restoreInspectorFocus", () => {
  beforeEach(() => {
    document.body.innerHTML = `<main><h1>Inventory</h1><input aria-label="Search inventory"><a href="${href("A-1")}">A-1</a></main>`;
  });

  test("moves focus from <body> to the SKU's own link", () => {
    expect(document.activeElement).toBe(document.body);
    const target = restoreInspectorFocus("A-1");
    expect(target?.textContent).toBe("A-1");
    expect(document.activeElement).toBe(target);
  });

  test("leaves focus alone when the user has it on a real control", () => {
    const search = document.querySelector("input")!;
    search.focus();
    expect(restoreInspectorFocus("A-1")).toBeNull();
    expect(document.activeElement).toBe(search);
  });

  test("falls back to the page heading when the SKU is no longer on screen", () => {
    const target = restoreInspectorFocus("GONE-1");
    const h1 = document.querySelector("h1")!;
    expect(target).toBe(h1);
    expect(document.activeElement).toBe(h1);
    expect(h1.getAttribute("tabindex")).toBe("-1");
  });

  test("does nothing rather than guess when there is no heading either", () => {
    document.body.innerHTML = "<div></div>";
    expect(restoreInspectorFocus("GONE-1")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("InventoryDetailPanel closing", () => {
  const SKUS = ["A-1", "A-2", "A-3"];

  test("as an overlay, opening focuses Close and closing returns focus to the opening row", async () => {
    await show(<Page skus={SKUS} selected="A-2" />);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close details");

    await show(<Page skus={SKUS} />);
    await nextFrame();
    expect(document.activeElement).toBe(link("A-2"));
  });

  test("switching products while open restores to the product shown last", async () => {
    await show(<Page skus={SKUS} selected="A-1" />);
    await show(<Page skus={SKUS} selected="A-3" />);
    await show(<Page skus={SKUS} />);
    await nextFrame();
    expect(document.activeElement).toBe(link("A-3"));
  });

  test("when the product left the result set, focus goes to the heading, not a detached node", async () => {
    await show(<Page skus={SKUS} selected="A-2" />);
    await show(<Page skus={["A-1", "A-3"]} />);
    await nextFrame();
    expect(document.activeElement).toBe(document.querySelector("h1"));
    expect(document.activeElement?.isConnected).toBe(true);
  });

  test("a close caused by another control keeps focus on that control", async () => {
    await show(<Page skus={SKUS} selected="A-2" />);
    const other = link("A-3");
    other.focus();
    await show(<Page skus={SKUS} />);
    await nextFrame();
    expect(document.activeElement).toBe(other);
  });
});
