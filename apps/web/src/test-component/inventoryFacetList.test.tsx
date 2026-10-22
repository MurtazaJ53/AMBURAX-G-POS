import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "./render";
import { InventoryFacetList } from "@/components/inventory/InventoryFacetList";

vi.mock("next/link", () => ({
  default: ({ children, href, className, ...rest }: any) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => cleanup());

describe("InventoryFacetList", () => {
  test("shows each value with its count, linking to the existing category filter", () => {
    render(
      <InventoryFacetList
        kind="category"
        values={[
          { value: "Shirts", count: 12 },
          { value: "Kids & Teens", count: 1 },
        ]}
      />,
    );
    const shirts = screen.getByRole("link", { name: /Shirts/ });
    expect(shirts.getAttribute("href")).toBe("/inventory?category=Shirts");
    expect(shirts.textContent).toContain("12");
    // Values are URL-encoded so "&" cannot split the filter.
    expect(screen.getByRole("link", { name: /Kids & Teens/ }).getAttribute("href")).toBe("/inventory?category=Kids+%26+Teens");
    expect(screen.getByLabelText("1 stock item")).toBeTruthy();
  });

  test("brand values link to the existing brand filter", () => {
    render(<InventoryFacetList kind="brand" values={[{ value: "Acme", count: 3 }]} />);
    expect(screen.getByRole("link", { name: /Acme/ }).getAttribute("href")).toBe("/inventory?brand=Acme");
    expect(screen.getByLabelText("3 stock items")).toBeTruthy();
  });

  test.each([
    ["category", "No products in this store have a category yet."],
    ["brand", "No products in this store have a brand yet."],
  ] as const)("shows an empty state for %s with no links", (kind, text) => {
    render(<InventoryFacetList kind={kind} values={[]} />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  test("is read-only: no add, rename, merge or delete controls", () => {
    render(<InventoryFacetList kind="category" values={[{ value: "Shirts", count: 2 }]} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByText(/Read-only/)).toBeTruthy();
  });
});
