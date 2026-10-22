import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "./render";
import { InventoryTabs } from "@/components/inventory/InventoryTabs";

vi.mock("next/link", () => ({
  default: ({ children, href, className, ...rest }: any) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * The Low Stock tab is the existing `status=low_stock` filter. The query, threshold and scoping
 * are covered by inventoryStockStatus.test.ts and inventoryFilters.test.ts; this checks the tab.
 */

beforeEach(() => cleanup());

describe("InventoryTabs", () => {
  test("Low Stock links to the existing low_stock filter", () => {
    render(<InventoryTabs />);
    const lowStock = screen.getByRole("link", { name: "Low Stock" });
    expect(lowStock.getAttribute("href")).toBe("/inventory?status=low_stock");
  });

  test("Stock Overview is active and Low Stock is not, with no status filter", () => {
    render(<InventoryTabs />);
    expect(screen.getByText("Stock Overview").getAttribute("aria-current")).toBe("page");
    const lowStock = screen.getByRole("link", { name: "Low Stock" });
    expect(lowStock.getAttribute("aria-current")).toBeNull();
    expect(lowStock.className).toContain("border-transparent");
  });

  test("Low Stock is active and Stock Overview links back when status=low_stock", () => {
    render(<InventoryTabs status="low_stock" />);
    const lowStock = screen.getByRole("link", { name: "Low Stock" });
    expect(lowStock.getAttribute("aria-current")).toBe("page");
    expect(lowStock.className).toContain("border-primary");
    expect(lowStock.className).toContain("text-primary");
    const overview = screen.getByRole("link", { name: "Stock Overview" });
    expect(overview.getAttribute("href")).toBe("/inventory");
    expect(overview.getAttribute("aria-current")).toBeNull();
  });

  test.each(["in_stock", "out_of_stock", "unknown"])("Low Stock is not active for status=%s", (status) => {
    render(<InventoryTabs status={status} />);
    expect(screen.getByRole("link", { name: "Low Stock" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByText("Stock Overview").getAttribute("aria-current")).toBe("page");
  });

  test.each([
    ["variants", "Variants"],
    ["categories", "Categories"],
    ["brands", "Brands"],
  ] as const)("tab=%s links to its read-only view and is the only active tab", (tab, label) => {
    render(<InventoryTabs tab={tab} status="low_stock" />);
    const link = screen.getByRole("link", { name: label });
    expect(link.getAttribute("href")).toBe(`/inventory?tab=${tab}`);
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.className).toContain("border-primary");
    // A view tab outranks a stale status filter, and Stock Overview becomes a link back.
    expect(screen.getByRole("link", { name: "Low Stock" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Stock Overview" }).getAttribute("href")).toBe("/inventory");
    for (const other of ["Variants", "Categories", "Brands"].filter((l) => l !== label)) {
      expect(screen.getByRole("link", { name: other }).getAttribute("aria-current")).toBeNull();
    }
  });

  test("aging, stock take and transfers are real screens now", () => {
    render(<InventoryTabs status="low_stock" />);
    expect(screen.getByRole("link", { name: "Aging" }).getAttribute("href")).toBe("/inventory/aging");
    expect(screen.getByRole("link", { name: "Stock Take" }).getAttribute("href")).toBe("/inventory/stock-take");
    expect(screen.getByRole("link", { name: "Replenish" }).getAttribute("href")).toBe("/inventory/replenishment");
    expect(screen.getByRole("link", { name: "Locations" }).getAttribute("href")).toBe("/inventory/locations");
    expect(screen.getByRole("link", { name: "Transfers" }).getAttribute("href")).toBe("/inventory/transfers");
    expect(screen.queryByText("Expiring / Aging")).toBeNull();
  });
});
