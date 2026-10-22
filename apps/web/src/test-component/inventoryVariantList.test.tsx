import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "./render";
import { InventoryVariantList, type InventoryVariantRow } from "@/components/inventory/InventoryVariantList";

vi.mock("next/link", () => ({
  default: ({ children, href, className, ...rest }: any) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * The Variants tab renders rows from `listStockLevels`; its tenant/store isolation is covered by
 * inventoryFilters.test.ts ("the three filters partition the store with nothing from another store
 * or tenant"). This checks what the tab shows.
 */

const row = (overrides: Partial<InventoryVariantRow["variant"]> = {}, quantity = 7): InventoryVariantRow => ({
  quantity,
  variant: {
    sku: "SHIRT-M-BLUE",
    size: "M",
    colour: "Blue",
    barcode: "8901234567890",
    isActive: true,
    product: { name: "Cotton Shirt", isActive: true },
    ...overrides,
  },
});

beforeEach(() => cleanup());

describe("InventoryVariantList", () => {
  test("shows each variant's product, SKU, size, colour, barcode, status and on-hand quantity", () => {
    render(<InventoryVariantList rows={[row()]} total={1} page={1} pageSize={50} />);
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(["Cotton Shirt", "SHIRT-M-BLUE", "M", "Blue", "8901234567890", "Active", "7"]);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Product", "SKU", "Size", "Colour", "Barcode", "Status", "On hand",
    ]);
  });

  test("shows dashes for missing size, colour and barcode, and zero or negative stock as stored", () => {
    render(
      <InventoryVariantList
        rows={[row({ sku: "A", size: null, colour: null, barcode: null }, 0), row({ sku: "B" }, -2)]}
        total={2}
        page={1}
        pageSize={50}
      />,
    );
    const [, first, second] = screen.getAllByRole("row");
    expect(within(first!).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Cotton Shirt", "A", "—", "—", "—", "Active", "0"]);
    expect(within(second!).getAllByRole("cell").at(-1)?.textContent).toBe("-2");
  });

  test("marks a variant inactive when it or its product is inactive", () => {
    render(
      <InventoryVariantList
        rows={[row({ sku: "V-OFF", isActive: false }), row({ sku: "P-OFF", product: { name: "Old", isActive: false } })]}
        total={2}
        page={1}
        pageSize={50}
      />,
    );
    const statuses = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[5]!.textContent);
    expect(statuses).toEqual(["Inactive", "Inactive"]);
  });

  test("shows an empty state with no table or paging", () => {
    render(<InventoryVariantList rows={[]} total={0} page={1} pageSize={50} />);
    expect(screen.getByText("No variants are stocked in this store yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  test("pages within the Variants tab", () => {
    render(<InventoryVariantList rows={[row()]} total={120} page={2} pageSize={50} />);
    expect(screen.getByText(/Showing 51.100 of 120 variants/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Previous" }).getAttribute("href")).toBe("/inventory?tab=variants");
    expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe("/inventory?tab=variants&page=3");
  });

  test("is read-only: no buttons or inputs", () => {
    render(<InventoryVariantList rows={[row()]} total={1} page={1} pageSize={50} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByText(/Read-only/)).toBeTruthy();
  });
});
