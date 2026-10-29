import { fireEvent } from "@testing-library/dom";
import { render, screen, within } from "./render";
import { expect, test, vi } from "vitest";

/**
 * The catalogue workspace, rendered.
 *
 * The assertions worth having here are about what the screen refuses to claim. The design
 * reference shows a discount on every card, a low-stock badge, favourite hearts, a multi-image
 * gallery and a margin figure; AMBURAX can support the first only when an MRP exists, and none
 * of the rest at all. So alongside the data-mapping checks, several tests assert absence.
 */

const push = vi.fn();
vi.mock("@/test-component/nextNavigationStub.ts", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/products",
}));

import { CatalogToolbar, ProductCard, ProductGrid } from "@/components/catalog/CatalogGrid";
import { ProductDetailPanel } from "@/components/catalog/ProductDetailPanel";
import { EMPTY_FILTERS, type CatalogFilters } from "@/server/catalog/catalogFilters";
import type { ProductDetail, ProductRow } from "@/server/catalog/catalogQueries";

const discounted: ProductRow = {
  id: "p1",
  name: "Cotton Formal Shirt",
  category: "Shirts",
  brand: "Amburax Basics",
  imageUrl: "/demo/catalogue/shirts.svg",
  isActive: true,
  variantCount: 2,
  priceFromMinor: 129_900,
  priceToMinor: 134_900,
  stockQuantity: 24,
  variants: [
    {
      id: "v1",
      sku: "SHIRT-WHT-M",
      barcode: null,
      size: "M",
      colour: "White",
      priceMinor: 129_900,
      mrpMinor: 159_900,
      taxTreatment: "TAXABLE",
      taxRateBp: 500,
      isActive: true,
      stockQuantity: 24,
    },
    {
      id: "v2",
      sku: "SHIRT-BLU-L",
      barcode: null,
      size: "L",
      colour: "Blue",
      priceMinor: 134_900,
      mrpMinor: null,
      taxTreatment: "TAXABLE",
      taxRateBp: 500,
      isActive: true,
      stockQuantity: 0,
    },
  ],
};

const plain: ProductRow = {
  ...discounted,
  id: "p2",
  name: "Wool Scarf",
  imageUrl: null,
  brand: null,
  variantCount: 1,
  priceFromMinor: 49_900,
  priceToMinor: 49_900,
  stockQuantity: null,
  variants: [
    {
      id: "v3",
      sku: "SCARF-GRY",
      barcode: null,
      size: null,
      colour: "Sea Green",
      priceMinor: 49_900,
      // No MRP, so no discount can be claimed for it.
      mrpMinor: null,
      taxTreatment: "TAXABLE",
      taxRateBp: 500,
      isActive: true,
      stockQuantity: null,
    },
  ],
};

const filters: CatalogFilters = { ...EMPTY_FILTERS };

// ── Cards ────────────────────────────────────────────────────────────────────

test("a grid card shows the product's real name, SKU, brand and price", () => {
  render(<ProductCard product={discounted} filters={filters} selected={false} view="grid" />);

  expect(screen.getByText("Cotton Formal Shirt")).toBeTruthy();
  expect(screen.getByText("SHIRT-WHT-M")).toBeTruthy();
  expect(screen.getByText("Amburax Basics")).toBeTruthy();
  expect(screen.getByText(/₹1,299\.00/)).toBeTruthy();
});

test("a price range is shown when variants disagree, not a single invented price", () => {
  render(<ProductCard product={discounted} filters={filters} selected={false} view="grid" />);
  expect(screen.getByText(/₹1,349\.00/)).toBeTruthy();
});

test("the discount badge appears only where a real MRP backs it", () => {
  const withMrp = render(
    <ProductCard product={discounted} filters={filters} selected={false} view="grid" />,
  );
  // 1299 against an MRP of 1599 is 19% off — computed, not copied from the reference.
  expect(within(withMrp.container).getByText("19% off")).toBeTruthy();

  const plainCard = render(
    <ProductCard product={plain} filters={filters} selected={false} view="grid" />,
  );
  expect(within(plainCard.container).queryByText(/% off/)).toBeNull();
});

test("stock states are distinguished, including never-counted", () => {
  const inStock = render(
    <ProductCard product={discounted} filters={filters} selected={false} view="grid" />,
  );
  expect(within(inStock.container).getByText("In stock (24)")).toBeTruthy();

  const uncounted = render(
    <ProductCard product={plain} filters={filters} selected={false} view="grid" />,
  );
  // Never counted must not render as "Out of stock" — they are different facts.
  expect(within(uncounted.container).getByText("Never counted here")).toBeTruthy();
  expect(within(uncounted.container).queryByText("Out of stock")).toBeNull();
});

test("a product with no picture falls back to its initial, and one with a picture shows it", () => {
  const withImage = render(
    <ProductCard product={discounted} filters={filters} selected={false} view="grid" />,
  );
  expect(withImage.container.querySelector("img")?.getAttribute("src")).toBe(
    "/demo/catalogue/shirts.svg",
  );

  const withoutImage = render(
    <ProductCard product={plain} filters={filters} selected={false} view="grid" />,
  );
  expect(withoutImage.container.querySelector("img")).toBeNull();
  expect(within(withoutImage.container).getByText("W")).toBeTruthy();
});

test("a colour with no honest swatch renders as its name instead", () => {
  const { container } = render(
    <ProductCard product={plain} filters={filters} selected={false} view="grid" />,
  );
  expect(within(container).getByText("Sea Green")).toBeTruthy();
});

test("no favourite control is rendered, because favourites are not modelled", () => {
  render(<ProductCard product={discounted} filters={filters} selected={false} view="grid" />);
  expect(screen.queryByRole("button", { name: /favourite|favorite/i })).toBeNull();
});

// ── Selection ────────────────────────────────────────────────────────────────

test("selecting a product puts it in the URL and keeps the rest of the state", () => {
  const busy: CatalogFilters = {
    ...filters,
    categories: ["Shirts"],
    sort: "price_asc",
    view: "list",
    page: 3,
  };
  const { container } = render(
    <ProductCard product={discounted} filters={busy} selected={false} view="list" />,
  );

  const href = within(container).getByRole("link").getAttribute("href") ?? "";
  expect(href).toContain("sel=p1");
  expect(href).toContain("cat=Shirts");
  expect(href).toContain("sort=price_asc");
  expect(href).toContain("view=list");
  expect(href).toContain("page=3");
});

test("clicking the open product closes the panel", () => {
  const { container } = render(
    <ProductCard
      product={discounted}
      filters={{ ...filters, selectedId: "p1" }}
      selected={true}
      view="grid"
    />,
  );
  expect(within(container).getByRole("link").getAttribute("href")).not.toContain("sel=");
});

// ── Toolbar ──────────────────────────────────────────────────────────────────

test("the toolbar reports the real total, not a hardcoded one", () => {
  render(<CatalogToolbar filters={filters} total={37} page={1} pageCount={4} />);
  expect(screen.getByText("37 products")).toBeTruthy();
});

test("the view toggle preserves filters, sort, page and selection", () => {
  const busy: CatalogFilters = {
    ...filters,
    query: "shirt",
    sort: "newest",
    page: 2,
    selectedId: "p1",
  };
  const { container } = render(
    <CatalogToolbar filters={busy} total={37} page={2} pageCount={4} />,
  );

  const listHref =
    within(container).getByRole("link", { name: "List view" }).getAttribute("href") ?? "";
  expect(listHref).toContain("view=list");
  expect(listHref).toContain("q=shirt");
  expect(listHref).toContain("sort=newest");
  expect(listHref).toContain("page=2");
  expect(listHref).toContain("sel=p1");
});

test("pagination is windowed and marks the current page", () => {
  const { container } = render(
    <CatalogToolbar filters={filters} total={600} page={5} pageCount={50} />,
  );

  expect(within(container).getByRole("link", { current: "page" }).textContent).toBe("5");
  expect(within(container).getByRole("link", { name: "Next page" })).toBeTruthy();
  expect(within(container).getByRole("link", { name: "Previous page" })).toBeTruthy();
  // 50 pages cannot print 50 buttons.
  expect(within(container).getAllByText("···").length).toBeGreaterThan(0);
});

test("a single page renders no pagination at all", () => {
  const { container } = render(
    <CatalogToolbar filters={filters} total={4} page={1} pageCount={1} />,
  );
  expect(within(container).queryByRole("navigation", { name: "Catalogue pages" })).toBeNull();
});


// ── Detail panel ─────────────────────────────────────────────────────────────

const detail: ProductDetail = {
  product: discounted,
  storeStock: [
    { storeId: "s1", storeName: "Main Store", storeCode: "MAIN", quantity: 24 },
    { storeId: "s2", storeName: "Second Store", storeCode: "TWO", quantity: 6 },
  ],
  sales: {
    unitsSold: 9,
    revenueMinor: 45_000,
    windowDays: 30,
    lastSoldAt: new Date("2026-09-18T03:45:00Z"),
  },
  createdAt: new Date("2026-01-04T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  baseUomCode: "PCS",
};

test("the panel opens on Stock and sums the real per-store counts", () => {
  const { container } = render(
    <ProductDetailPanel detail={detail} filters={filters} canManage={true} />,
  );

  expect(within(container).getByText("Main Store")).toBeTruthy();
  expect(within(container).getByText(/Second Store/)).toBeTruthy();
  expect(within(container).getAllByText("30").length).toBeGreaterThan(0); // 24 + 6, not a reference figure
  expect(within(container).getByText(/operational count, not an accounting ledger/)).toBeTruthy();
});

test("the variant count is the product's own, not the reference's fixed twelve", () => {
  const { container } = render(
    <ProductDetailPanel detail={detail} filters={filters} canManage={true} />,
  );
  const card = within(container).getByText("Variants").parentElement!;
  expect(within(card).getByText("2")).toBeTruthy();
  expect(within(card).queryByText("12")).toBeNull();
});

test("the pricing tab shows the real selling price and states no margin", () => {
  const { container } = render(
    <ProductDetailPanel detail={detail} filters={filters} canManage={true} />,
  );
  fireEvent.click(within(container).getByRole("tab", { name: "Pricing" }));

  expect(within(container).getByText("Selling Price")).toBeTruthy();
  expect(within(container).queryByText(/margin/i)).toBeNull();
});

test("the pricing tab lists every variant by SKU with its own price", () => {
  const { container } = render(
    <ProductDetailPanel detail={detail} filters={filters} canManage={true} />,
  );
  fireEvent.click(within(container).getByRole("tab", { name: "Pricing" }));

  const list = within(container).getByRole("list", { name: "Variant prices" });
  const rows = within(list).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(within(rows[0]!).getByText("SHIRT-WHT-M")).toBeTruthy();
  expect(within(rows[0]!).getByText("₹1,299.00")).toBeTruthy();
  expect(within(rows[1]!).getByText("SHIRT-BLU-L")).toBeTruthy();
  expect(within(rows[1]!).getByText("₹1,349.00")).toBeTruthy();
});

test("the images tab shows the product's one real picture, or says there is none", () => {
  const { container } = render(
    <ProductDetailPanel detail={detail} filters={filters} canManage={true} />,
  );
  fireEvent.click(within(container).getByRole("tab", { name: "Images" }));

  expect(within(container).queryByText("No picture set for this product.")).toBeNull();
  const srcs = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
  expect(new Set(srcs)).toEqual(new Set(["/demo/catalogue/shirts.svg"]));

  const none = render(
    <ProductDetailPanel detail={{ ...detail, product: { ...discounted, imageUrl: null } }} filters={filters} canManage={true} />,
  );
  fireEvent.click(within(none.container).getByRole("tab", { name: "Images" }));
  expect(within(none.container).getByText("No picture set for this product.")).toBeTruthy();
});

test("the sales tab reports real figures over a named window", () => {
  const { container } = render(
    <ProductDetailPanel detail={detail} filters={filters} canManage={true} />,
  );
  fireEvent.click(within(container).getByRole("tab", { name: "Sales" }));

  expect(within(container).getByText("Units sold (30 days)")).toBeTruthy();
  expect(within(container).getByText("9")).toBeTruthy();
});

test("a product that has never sold says so instead of showing zeroes", () => {
  const { container } = render(
    <ProductDetailPanel detail={{ ...detail, sales: null }} filters={filters} canManage={true} />,
  );
  fireEvent.click(within(container).getByRole("tab", { name: "Sales" }));
  expect(within(container).getByText("This product has never been sold.")).toBeTruthy();
});

test("edit is hidden from someone who may not manage the catalogue", () => {
  const managing = render(
    <ProductDetailPanel detail={detail} filters={filters} canManage={true} />,
  );
  expect(within(managing.container).getByRole("link", { name: /Edit product/ })).toBeTruthy();
  expect(
    within(managing.container).getByRole("link", { name: /Create variant/ }).getAttribute("href"),
  ).toBe("/products/p1/variants/new");

  const readOnly = render(
    <ProductDetailPanel detail={detail} filters={filters} canManage={false} />,
  );
  expect(within(readOnly.container).queryByRole("link", { name: /Edit product/ })).toBeNull();
  expect(within(readOnly.container).queryByRole("link", { name: /Create variant/ })).toBeNull();
  // Stock is a read, so it stays available to everyone.
  expect(within(readOnly.container).getByRole("link", { name: /Adjust stock/ })).toBeTruthy();
});

test("no unbacked quick actions are offered", () => {
  const { container } = render(
    <ProductDetailPanel detail={detail} filters={filters} canManage={true} />,
  );
  expect(within(container).queryByText("Duplicate")).toBeNull();
  expect(within(container).queryByText("Add to Offer")).toBeNull();
  expect(within(container).queryByText("View in ERPNext")).toBeNull();
});

test("the setup checklist links to the edit page only for someone who may manage the catalogue", () => {
  const noPhoto = { ...detail, product: { ...discounted, imageUrl: null } };

  const managing = render(<ProductDetailPanel detail={noPhoto} filters={filters} canManage={true} />);
  for (const name of [/Add cost price/, /Add photo/]) {
    const links = within(managing.container).getAllByRole("link", { name });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(links.map(() => "/products/p1/edit"));
  }

  const readOnly = render(<ProductDetailPanel detail={noPhoto} filters={filters} canManage={false} />);
  for (const name of [/Add cost price/, /Add photo/]) {
    expect(within(readOnly.container).queryByRole("link", { name })).toBeNull();
    expect(within(readOnly.container).getByText(name)).toBeTruthy();
  }
  const editLinks = [...readOnly.container.querySelectorAll("a")].filter((a) =>
    (a.getAttribute("href") ?? "").includes("/edit"),
  );
  expect(editLinks).toHaveLength(0);
});
