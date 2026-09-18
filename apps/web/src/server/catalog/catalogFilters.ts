/**
 * The catalogue workspace's filter vocabulary, as data.
 *
 * Every piece of workspace state — the search box, each filter, the sort, the view mode, the
 * page and which product is open in the panel — lives in the URL rather than in React state.
 * That is what makes the design reference's behaviour work honestly: switching grid to list
 * keeps the filters, the selection and the page, because none of them were ever held
 * anywhere a re-render could lose them. It also means a filtered catalogue is a link someone
 * can send to a colleague.
 *
 * Parsing and serialising live here, apart from both the queries and the components, so the
 * round trip can be tested without a database or a DOM.
 */

/** Stock states AMBURAX can actually prove for a product in a store. */
export type StockStatus = "in" | "out" | "uncounted";

/**
 * Note what is missing: "low stock".
 *
 * The design reference offers it, and it needs a reorder level to mean anything. No such
 * column exists (ADR-080), so a "low" filter would be a threshold this product invented and
 * then presented as the merchant's own. "Never counted" takes its place — that is a real
 * state, it is the one most worth acting on in a young catalogue, and a count of zero is
 * genuinely different from never having counted.
 */
export const STOCK_STATUSES: { id: StockStatus; label: string }[] = [
  { id: "in", label: "In stock" },
  { id: "out", label: "Out of stock" },
  { id: "uncounted", label: "Never counted here" },
];

export type SortOption = "name" | "name_desc" | "price_asc" | "price_desc" | "newest" | "oldest";

export const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: "name", label: "Name (A-Z)" },
  { id: "name_desc", label: "Name (Z-A)" },
  { id: "price_asc", label: "Price: low to high" },
  { id: "price_desc", label: "Price: high to low" },
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
];

export type ViewMode = "grid" | "list";

export interface CatalogFilters {
  /** Free text over name, category, brand, SKU and barcode. */
  query: string;
  categories: string[];
  brands: string[];
  sizes: string[];
  colours: string[];
  /** Inclusive bounds in minor units. Null means unbounded on that side. */
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
  stock: StockStatus[];
  sort: SortOption;
  view: ViewMode;
  page: number;
  /** The product open in the detail panel, if any. */
  selectedId: string | null;
}

export const EMPTY_FILTERS: CatalogFilters = {
  query: "",
  categories: [],
  brands: [],
  sizes: [],
  colours: [],
  priceMinMinor: null,
  priceMaxMinor: null,
  stock: [],
  sort: "name",
  view: "grid",
  page: 1,
  selectedId: null,
};

export function isSortOption(value: unknown): value is SortOption {
  return SORT_OPTIONS.some((option) => option.id === value);
}

function isStockStatus(value: string): value is StockStatus {
  return value === "in" || value === "out" || value === "uncounted";
}

/**
 * Multi-value parameters arrive either repeated or comma-joined depending on who built the
 * link, so both are accepted. Blanks are dropped rather than becoming an empty-string filter
 * that matches nothing and looks like a bug.
 */
function readList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Rupees in the URL, paise in the domain — a shopkeeper types 500, not 50000. */
function readMajorAsMinor(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export type SearchParamsInput = Record<string, string | string[] | undefined>;

export function parseCatalogFilters(params: SearchParamsInput): CatalogFilters {
  const single = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const rawPage = Number(single("page") ?? 1);
  const sort = single("sort");
  const view = single("view");
  const priceMinMinor = readMajorAsMinor(params.min);
  const priceMaxMinor = readMajorAsMinor(params.max);
  const reversed =
    priceMinMinor !== null && priceMaxMinor !== null && priceMinMinor > priceMaxMinor;

  return {
    query: (single("q") ?? "").trim().slice(0, 120),
    categories: readList(params.cat),
    brands: readList(params.brand),
    sizes: readList(params.size),
    colours: readList(params.colour),
    // A reversed range filters everything out and reads as a broken screen, so the two
    // bounds are swapped back into order rather than obeyed literally.
    priceMinMinor: reversed ? priceMaxMinor : priceMinMinor,
    priceMaxMinor: reversed ? priceMinMinor : priceMaxMinor,
    stock: readList(params.stock).filter(isStockStatus),
    sort: isSortOption(sort) ? sort : "name",
    view: view === "list" ? "list" : "grid",
    page: Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1,
    selectedId: single("sel") ?? null,
  };
}

/**
 * Back to a query string.
 *
 * Defaults are omitted, so an unfiltered catalogue is `/products` rather than a paragraph of
 * empty parameters — which matters because this is the URL a person copies out of the bar.
 */
export function serializeCatalogFilters(filters: CatalogFilters): string {
  const params = new URLSearchParams();

  if (filters.query) params.set("q", filters.query);
  if (filters.categories.length) params.set("cat", filters.categories.join(","));
  if (filters.brands.length) params.set("brand", filters.brands.join(","));
  if (filters.sizes.length) params.set("size", filters.sizes.join(","));
  if (filters.colours.length) params.set("colour", filters.colours.join(","));
  if (filters.priceMinMinor !== null) params.set("min", String(filters.priceMinMinor / 100));
  if (filters.priceMaxMinor !== null) params.set("max", String(filters.priceMaxMinor / 100));
  if (filters.stock.length) params.set("stock", filters.stock.join(","));
  if (filters.sort !== "name") params.set("sort", filters.sort);
  if (filters.view !== "grid") params.set("view", filters.view);
  if (filters.page > 1) params.set("page", String(filters.page));
  if (filters.selectedId) params.set("sel", filters.selectedId);

  const query = params.toString();
  return query ? `?${query}` : "";
}

/** A link to the catalogue in the given state. */
export function catalogHref(filters: CatalogFilters): string {
  return `/products${serializeCatalogFilters(filters)}`;
}

/**
 * Change one thing and return to page one.
 *
 * Every filter change resets the page, because staying on page 7 of a result set that just
 * shrank to two pages shows an empty grid and reads as "no products" rather than "wrong
 * page". Callers that are paging pass `page` explicitly to override this.
 */
export function withFilters(
  filters: CatalogFilters,
  changes: Partial<CatalogFilters>,
): CatalogFilters {
  return { ...filters, page: 1, ...changes };
}

/** Add or remove one value from a multi-select filter. */
export function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

/** Whether anything is narrowing the catalogue — drives the "Clear all" affordance. */
export function hasActiveFilters(filters: CatalogFilters): boolean {
  return (
    filters.query.length > 0 ||
    filters.categories.length > 0 ||
    filters.brands.length > 0 ||
    filters.sizes.length > 0 ||
    filters.colours.length > 0 ||
    filters.priceMinMinor !== null ||
    filters.priceMaxMinor !== null ||
    filters.stock.length > 0
  );
}

/**
 * Discount against MRP.
 *
 * A real computation over two real columns, which is why it survives when the reference's
 * "~38% margin" does not: margin needs a cost price, and no variant carries one. Null unless
 * there is an MRP above the selling price — a product priced at its MRP is not "0% off", it
 * simply is not discounted, and a badge reading 0% is noise.
 */
export function discountPercent(priceMinor: number, mrpMinor: number | null): number | null {
  if (mrpMinor === null || mrpMinor <= 0 || mrpMinor <= priceMinor) return null;
  return Math.round(((mrpMinor - priceMinor) / mrpMinor) * 100);
}

/** What the store's count says about a product. Null quantity is "never counted", not zero. */
export function stockStatusOf(quantity: number | null): StockStatus {
  if (quantity === null) return "uncounted";
  return quantity > 0 ? "in" : "out";
}

export function stockStatusLabel(status: StockStatus, quantity: number | null): string {
  switch (status) {
    case "in":
      return `In stock (${quantity ?? 0})`;
    case "out":
      // Negative is possible: nothing prevents overselling, so the projection can drift below
      // zero, and saying "oversold" is more use than clamping it to "out of stock".
      return quantity !== null && quantity < 0 ? `Oversold (${quantity})` : "Out of stock";
    case "uncounted":
      return "Never counted here";
  }
}

/** Colour chips need a swatch; variant colours are free text, so this is a best-effort map. */
const COLOUR_HEX: Record<string, string> = {
  black: "#0f172a",
  white: "#ffffff",
  blue: "#2563eb",
  navy: "#1e3a5f",
  red: "#dc2626",
  maroon: "#7f1d1d",
  green: "#059669",
  olive: "#4d7c0f",
  grey: "#64748b",
  gray: "#64748b",
  beige: "#d6c7a1",
  brown: "#78350f",
  pink: "#db2777",
  yellow: "#eab308",
  orange: "#ea580c",
  purple: "#7c3aed",
  cream: "#f5f0e1",
  floral: "#e0b0c0",
  natural: "#d9cbb3",
};

/**
 * A swatch for a colour name, or null when the name is not one we can render.
 *
 * Null matters: a chip filled with an arbitrary colour would tell a shopkeeper their "Sea
 * Green" product is grey. Callers render the name as text instead.
 */
export function colourSwatch(name: string): string | null {
  return COLOUR_HEX[name.trim().toLowerCase()] ?? null;
}
