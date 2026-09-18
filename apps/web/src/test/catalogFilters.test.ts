import { describe, expect, test } from "vitest";
import {
  EMPTY_FILTERS,
  catalogHref,
  colourSwatch,
  discountPercent,
  hasActiveFilters,
  isSortOption,
  parseCatalogFilters,
  serializeCatalogFilters,
  stockStatusLabel,
  stockStatusOf,
  toggleValue,
  withFilters,
} from "@/server/catalog/catalogFilters";

/**
 * The catalogue's URL state.
 *
 * Worth testing as data because the whole workspace hangs off it: if a round trip loses the
 * selection, the reference's "switch grid to list and keep your place" behaviour silently
 * breaks, and nothing about the rendered page would look wrong. The money assertions matter
 * for the same reason — a filter that reads rupees as paise returns an empty catalogue and
 * looks like a backend fault.
 */

/** Turn a serialised query string back into the shape Next hands a page. */
function paramsOf(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search.replace(/^\?/, "")));
}

describe("parseCatalogFilters", () => {
  test("an empty query string is the neutral state", () => {
    expect(parseCatalogFilters({})).toEqual(EMPTY_FILTERS);
  });

  test("reads every filter, accepting comma-joined and repeated values alike", () => {
    const filters = parseCatalogFilters({
      q: "  shirt  ",
      cat: "Shirts,Trousers",
      brand: ["Levis", "Arrow"],
      size: "M,L",
      colour: "Blue",
      stock: "in,out",
      sort: "price_desc",
      view: "list",
      page: "3",
      sel: "prod_1",
    });

    expect(filters.query).toBe("shirt");
    expect(filters.categories).toEqual(["Shirts", "Trousers"]);
    expect(filters.brands).toEqual(["Levis", "Arrow"]);
    expect(filters.sizes).toEqual(["M", "L"]);
    expect(filters.colours).toEqual(["Blue"]);
    expect(filters.stock).toEqual(["in", "out"]);
    expect(filters.sort).toBe("price_desc");
    expect(filters.view).toBe("list");
    expect(filters.page).toBe(3);
    expect(filters.selectedId).toBe("prod_1");
  });

  test("prices are rupees in the URL and paise in the domain", () => {
    const filters = parseCatalogFilters({ min: "500", max: "1299.50" });
    expect(filters.priceMinMinor).toBe(50_000);
    expect(filters.priceMaxMinor).toBe(129_950);
  });

  test("a reversed price range is put back in order rather than obeyed", () => {
    // Obeying it literally returns nothing and reads as a broken catalogue.
    const filters = parseCatalogFilters({ min: "900", max: "100" });
    expect(filters.priceMinMinor).toBe(10_000);
    expect(filters.priceMaxMinor).toBe(90_000);
  });

  test("nonsense is ignored rather than trusted", () => {
    const filters = parseCatalogFilters({
      min: "-5",
      max: "abc",
      stock: "in,teleported",
      sort: "by_vibes",
      view: "hologram",
      page: "0",
    });

    expect(filters.priceMinMinor).toBeNull();
    expect(filters.priceMaxMinor).toBeNull();
    expect(filters.stock).toEqual(["in"]);
    expect(filters.sort).toBe("name");
    expect(filters.view).toBe("grid");
    expect(filters.page).toBe(1);
  });

  test("blank entries in a list do not become filters that match nothing", () => {
    expect(parseCatalogFilters({ cat: "Shirts,,  ,Trousers" }).categories).toEqual([
      "Shirts",
      "Trousers",
    ]);
  });
});

describe("serializeCatalogFilters", () => {
  test("the neutral state serialises to nothing", () => {
    expect(serializeCatalogFilters(EMPTY_FILTERS)).toBe("");
    expect(catalogHref(EMPTY_FILTERS)).toBe("/products");
  });

  test("round trips every field", () => {
    const original = {
      ...EMPTY_FILTERS,
      query: "kurti",
      categories: ["Dresses"],
      brands: ["Aurelia"],
      sizes: ["M"],
      colours: ["Pink"],
      priceMinMinor: 50_000,
      priceMaxMinor: 150_000,
      stock: ["in" as const],
      sort: "price_asc" as const,
      view: "list" as const,
      page: 4,
      selectedId: "prod_9",
    };

    expect(parseCatalogFilters(paramsOf(serializeCatalogFilters(original)))).toEqual(original);
  });

  test("the selection survives a view change, which is the point of URL state", () => {
    const selected = { ...EMPTY_FILTERS, selectedId: "prod_9", page: 2, sort: "newest" as const };
    const switched = { ...selected, view: "list" as const };

    const parsed = parseCatalogFilters(paramsOf(serializeCatalogFilters(switched)));
    expect(parsed.selectedId).toBe("prod_9");
    expect(parsed.page).toBe(2);
    expect(parsed.sort).toBe("newest");
    expect(parsed.view).toBe("list");
  });
});

describe("filter helpers", () => {
  test("toggleValue adds then removes", () => {
    expect(toggleValue([], "M")).toEqual(["M"]);
    expect(toggleValue(["M", "L"], "M")).toEqual(["L"]);
  });

  test("changing a filter returns to page one", () => {
    // Staying on page 7 of a result set that just shrank shows an empty grid, which reads as
    // "no products" rather than "wrong page".
    const paged = { ...EMPTY_FILTERS, page: 7 };
    expect(withFilters(paged, { categories: ["Shirts"] }).page).toBe(1);
  });

  test("an explicit page overrides the reset, so paging still works", () => {
    expect(withFilters({ ...EMPTY_FILTERS, page: 7 }, { page: 8 }).page).toBe(8);
  });

  test("hasActiveFilters ignores sort, view, page and selection", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(
      hasActiveFilters({
        ...EMPTY_FILTERS,
        sort: "price_asc",
        view: "list",
        page: 3,
        selectedId: "x",
      }),
    ).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, colours: ["Blue"] })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, priceMinMinor: 100 })).toBe(true);
  });

  test("only known sorts are accepted", () => {
    expect(isSortOption("price_asc")).toBe(true);
    expect(isSortOption("cheapest")).toBe(false);
  });
});

describe("discountPercent", () => {
  test("computes a real discount from two real columns", () => {
    expect(discountPercent(79_900, 129_900)).toBe(38);
  });

  test("is null when there is nothing to discount against", () => {
    // A product priced at its MRP is not "0% off" — it is simply not discounted, and a badge
    // reading 0% is noise on every card in the grid.
    expect(discountPercent(79_900, null)).toBeNull();
    expect(discountPercent(79_900, 79_900)).toBeNull();
    expect(discountPercent(79_900, 50_000)).toBeNull();
    expect(discountPercent(79_900, 0)).toBeNull();
  });
});

describe("stock status", () => {
  test("never counted is not the same as zero", () => {
    expect(stockStatusOf(null)).toBe("uncounted");
    expect(stockStatusOf(0)).toBe("out");
    expect(stockStatusOf(4)).toBe("in");
  });

  test("a negative count is reported as oversold rather than clamped", () => {
    expect(stockStatusOf(-3)).toBe("out");
    expect(stockStatusLabel("out", -3)).toBe("Oversold (-3)");
    expect(stockStatusLabel("out", 0)).toBe("Out of stock");
    expect(stockStatusLabel("in", 12)).toBe("In stock (12)");
    expect(stockStatusLabel("uncounted", null)).toBe("Never counted here");
  });
});

describe("colourSwatch", () => {
  test("maps known colour names case-insensitively", () => {
    expect(colourSwatch("Blue")).toBe("#2563eb");
    expect(colourSwatch("  navy ")).toBe("#1e3a5f");
  });

  test("returns null for a colour it cannot render honestly", () => {
    // The caller falls back to the name as text; a swatch filled with a guess would tell a
    // shopkeeper their "Sea Green" product is grey.
    expect(colourSwatch("Sea Green")).toBeNull();
  });
});
