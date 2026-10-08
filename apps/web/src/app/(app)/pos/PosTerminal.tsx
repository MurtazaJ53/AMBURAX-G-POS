"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  computeSaleTotals,
  formatMinor,
  MAX_LINE_QUANTITY,
  MAX_LINES_PER_SALE,
  type PricedLine,
} from "@/server/sales/saleTotals";
import {
  BadgePercent,
  Banknote,
  Baby,
  Briefcase,
  Check,
  ChevronDown,
  Copy,
  CreditCard,
  Download,
  Ellipsis,
  FileText,
  Flame,
  Footprints,
  History,
  LayoutGrid,
  Mail,
  MessageCircle,
  Minus,
  BookOpen,
  Package,
  PauseCircle,
  Plus,
  Printer,
  RefreshCcw,
  ScanLine,
  Search,
  Shirt,
  ShoppingCart,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Split,
  Store,
  Tag,
  Trash2,
  UserCog,
  UserPlus,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { formatDateTime } from "@/app/(app)/sales/formatDateTime";
import { CustomerPicker, type CustomerHit, type PickerMode } from "./CustomerPicker";
import { RetrieveBillModal, type HeldBill } from "./RetrieveBillModal";

interface CatalogHit {
  variantId: string;
  productName: string;
  imageUrl: string | null;
  sku: string;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  priceMinor: number;
  taxRateBp: number;
  stockQuantity: number | null;
}

interface CartLine extends PricedLine {
  variantId: string;
  productName: string;
  imageUrl: string | null;
  sku: string;
  size: string | null;
  colour: string | null;
  stockQuantity: number | null;
}

interface CompletedSale {
  id: string;
  billNumber: string;
  totalMinor: number;
  paidMinor: number;
  /** What this bill put on the customer's khata. */
  dueMinor: number;
  erpSyncStatus: string;
  duplicate: boolean;
}

/**
 * The completed sale as the server tells it, for the receipt on the success screen.
 *
 * `createSale` answers with totals and identifiers only — enough to say the sale happened,
 * not enough to print it. Rather than widen that response (a contract F9 settled, and one
 * this till is not the only caller of), the success screen re-reads the sale through the
 * bill endpoint that already exists and that `/sales/[id]` is already built on. One extra
 * round trip, once per sale, and every figure on the receipt then comes from the row rather
 * than from the cart the browser happened to be holding.
 *
 * `completedAt` arrives as an ISO string because this crossed JSON; it is parsed at the one
 * place it is rendered.
 */
interface SaleReceipt {
  id: string;
  billNumber: string;
  completedAt: string;
  erpSyncStatus: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  storeName: string;
  storeCode: string;
  storeAddressLine: string;
  storeCity: string;
  storeState: string;
  storePostalCode: string | null;
  cashierName: string;
  customer: { name: string; phone: string | null } | null;
  items: {
    id: string;
    name: string;
    sku: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    size: string | null;
    colour: string | null;
  }[];
  payments: {
    method: string;
    status: string;
    amountMinor: number;
    reference: string | null;
  }[];
}

type PaymentMethod = "CASH" | "UPI" | "CARD" | "SPLIT" | "UDHAR";

/**
 * The methods a single split row may carry.
 *
 * Narrower than `PaymentMethod` on purpose: "SPLIT" and "UDHAR" are modes of this panel, not ways
 * of paying, and the server's `createSaleSchema` accepts only these three. Typing the rows this
 * way means the payload built in `completeSale` needs no cast to satisfy the API contract — a row
 * cannot hold a value the server would reject.
 */
type SplitMethod = "CASH" | "UPI" | "CARD";

interface SplitRow {
  id: string;
  method: SplitMethod;
  amount: number | null;
  reference: string;
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
  { value: "SPLIT", label: "Split" },
  { value: "UDHAR", label: "Udhar" },
];

const PAYMENT_ICONS: Record<PaymentMethod, LucideIcon> = {
  CASH: Banknote,
  UPI: Smartphone,
  CARD: CreditCard,
  SPLIT: Split,
  UDHAR: BookOpen,
};

/**
 * An icon and tone for a category tile, from its name. Categories are the tenant's own — read
 * from the catalogue, never hard-coded — so a new one gets a sensible icon the moment it is
 * created, and anything unrecognised falls back to a neutral box rather than a wrong garment.
 */
function categoryLook(name: string, index: number): { icon: LucideIcon; tone: string } {
  const n = name.toLowerCase();
  const has = (...words: string[]) => words.some((w) => n.includes(w));
  if (has("women", "ladies", "kurti", "dress", "saree", "girl")) return { icon: Sparkles, tone: "text-pink-500" };
  if (has("men", "shirt", "gent", "boy")) return { icon: Shirt, tone: "text-sky-600" };
  if (has("kid", "child", "baby", "infant")) return { icon: Baby, tone: "text-amber-500" };
  if (has("ethnic", "festive", "traditional")) return { icon: Flame, tone: "text-emerald-500" };
  if (has("foot", "shoe", "sandal", "slipper", "sneaker")) return { icon: Footprints, tone: "text-violet-500" };
  if (has("access", "bag", "belt", "wallet", "cap", "jewel")) return { icon: Briefcase, tone: "text-orange-500" };
  if (has("inner", "under", "lingerie", "sock")) return { icon: Tag, tone: "text-slate-500" };
  if (has("mobile", "phone", "electronic", "gadget")) return { icon: Smartphone, tone: "text-blue-600" };
  const tones = ["text-sky-600", "text-violet-500", "text-emerald-500", "text-amber-500", "text-rose-500", "text-teal-600"];
  return { icon: Package, tone: tones[index % tones.length]! };
}

/** Price bands on the selling price, in minor units, inclusive. */
const PRICE_BANDS: { id: string; label: string; min?: number; max?: number }[] = [
  { id: "u500", label: "Under ₹500", max: 49_999 },
  { id: "500", label: "₹500 – ₹999", min: 50_000, max: 99_999 },
  { id: "1000", label: "₹1,000 – ₹1,999", min: 100_000, max: 199_999 },
  { id: "2000", label: "₹2,000 – ₹4,999", min: 200_000, max: 499_999 },
  { id: "5000", label: "₹5,000 and above", min: 500_000 },
];

interface PosFilters {
  category: string;
  brand: string;
  size: string;
  colour: string;
  price: string;
}

const NO_FILTERS: PosFilters = { category: "", brand: "", size: "", colour: "", price: "" };

interface PosFacets {
  categories: { value: string; count: number }[];
  brands: { value: string; count: number }[];
  sizes: string[];
  colours: string[];
}

/** Stock as the reference's pill: in, low (1–10, the inventory screen's rule), out, or unknown. */
function stockPill(quantity: number | null | undefined): { text: string; className: string; dot: string } {
  if (quantity == null) return { text: "Stock unknown", className: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400" };
  if (quantity <= 0) return { text: "Out of Stock", className: "border-rose-200 bg-rose-50 text-rose-600", dot: "bg-rose-500" };
  if (quantity <= 10) return { text: `Low Stock (${quantity})`, className: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500" };
  return { text: `In Stock (${quantity})`, className: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" };
}

/** Cash a customer is likely to hand over: the total rounded up to the next 100, 500 and 1,000. */
function tenderSuggestions(totalMinor: number): number[] {
  const total = totalMinor / 100;
  if (total <= 0) return [100, 500, 1000];
  const out: number[] = [];
  for (const step of [100, 500, 1000, 2000, 5000]) {
    const v = Math.ceil(total / step) * step;
    const next = v === total ? v + step : v;
    if (!out.includes(next)) out.push(next);
    if (out.length === 3) break;
  }
  return out;
}

interface SearchState<T> {
  term: string;
  results: T[];
  error: string | null;
}

const EMPTY_SEARCH = { term: "", results: [], error: null };

function variantLabel(line: { size: string | null; colour: string | null }): string | null {
  const parts = [line.colour, line.size].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : null;
}

function stockLabel(quantity: number | null): { text: string; className: string } {
  if (quantity === null) return { text: "Not counted", className: "text-slate-500" };
  if (quantity < 0)
    return { text: `Oversold (${quantity})`, className: "text-rose-600" };
  if (quantity === 0) return { text: "Out of stock", className: "text-amber-600" };
  return { text: `In Stock (${quantity})`, className: "text-emerald-600" };
}

export function PosTerminal(props: { storeName: string; storeCode: string; cashierName: string }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState<CatalogHit>>(EMPTY_SEARCH);
  
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartNotice, setCartNotice] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [picker, setPicker] = useState<{ open: boolean; mode: PickerMode }>({ open: false, mode: "search" });
  const openPicker = useCallback((open: boolean, mode?: PickerMode) => {
    setPicker((cur) => ({ open, mode: mode ?? (open ? cur.mode : "search") }));
  }, []);
  // Udhar: what the customer pays now (rupees, as typed) and how. The rest goes on khata.
  const [udharPaidRaw, setUdharPaidRaw] = useState("");
  const [udharPayMethod, setUdharPayMethod] = useState<SplitMethod>("CASH");
  
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [amountReceived, setAmountReceived] = useState<number | null>(null);

  const [splitPayments, setSplitPayments] = useState<SplitRow[]>([
    { id: "1", method: "CASH", amount: null, reference: "" },
    { id: "2", method: "UPI", amount: null, reference: "" }
  ]);
  
  const [submitting, setSubmitting] = useState(false);
  const [retrieveModalOpen, setRetrieveModalOpen] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompletedSale | null>(null);
  // The printable sale, re-read from the server after completion. Null while it is in
  // flight or if the read failed — the success screen degrades to the figures the sale
  // response already proved, and says so, rather than inventing a receipt.
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [receiptFailed, setReceiptFailed] = useState(false);

  const idempotencyKey = useRef<string>("");
  useEffect(() => {
    if (idempotencyKey.current === "") {
      idempotencyKey.current = typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString();
    }
  }, []);
  const searchInput = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);
  /*
    Bumped whenever the stock on screen may be stale — a sale just decremented it, or the
    cashier came back to this tab after stock moved elsewhere. Both catalogue effects depend on
    it, so the grid re-reads the same list it is showing without the cashier refreshing.
  */
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [filters, setFilters] = useState<PosFilters>(NO_FILTERS);
  const [facets, setFacets] = useState<PosFacets | null>(null);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setCatalogVersion((v) => v + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const term = query.trim();

  /*
    The grid's one source: the typed query and the filters together, as query parameters on the
    same search endpoint. Typing is debounced; a filter or category change fetches at once. The
    sequence number makes a slower, older response lose to a newer one, and the last list stays
    on screen (dimmed) while the next one loads, so changing a filter never flashes "no products".
  */
  const filterParams = (() => {
    const p = new URLSearchParams();
    if (filters.category) p.set("category", filters.category);
    if (filters.brand) p.set("brand", filters.brand);
    if (filters.size) p.set("size", filters.size);
    if (filters.colour) p.set("colour", filters.colour);
    const band = PRICE_BANDS.find((b) => b.id === filters.price);
    if (band?.min !== undefined) p.set("minPrice", String(band.min));
    if (band?.max !== undefined) p.set("maxPrice", String(band.max));
    return p.toString();
  })();
  const searchKey = `${term}|${filterParams}`;
  const filtersActive = filterParams.length > 0;

  useEffect(() => {
    const key = `${term}|${filterParams}`;
    const seq = ++requestSeq.current;
    const run = async () => {
      try {
        const res = await fetch(`/api/v1/catalog/search?q=${encodeURIComponent(term)}${filterParams ? `&${filterParams}` : ""}`);
        const data = await res.json();
        if (seq !== requestSeq.current) return;
        setSearch(
          res.ok
            ? { term: key, results: data.results as CatalogHit[], error: null }
            : { term: key, results: [], error: data?.error?.message ?? "Product lookup failed." },
        );
      } catch {
        if (seq !== requestSeq.current) return;
        setSearch({ term: key, results: [], error: "Product lookup failed. Check the connection and try again." });
      }
    };
    if (term.length === 0) {
      void run();
      return;
    }
    const timer = setTimeout(() => void run(), 200);
    return () => clearTimeout(timer);
  }, [term, filterParams, catalogVersion]);

  // Filter options from the catalogue itself: a category created in Products appears here on the
  // next load (or when the cashier returns to this tab), with no list to maintain.
  useEffect(() => {
    let alive = true;
    fetch("/api/v1/catalog/facets")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setFacets({ categories: d.categories ?? [], brands: d.brands ?? [], sizes: d.sizes ?? [], colours: d.colours ?? [] });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [catalogVersion]);

  const settled = search.term === searchKey;
  const results = search.results;
  const searchError = settled ? search.error : null;
  const searching = !settled;

  const addToCart = useCallback((hit: CatalogHit) => {
    setCartNotice(null);
    setSaleError(null);
    setCart((current) => {
      const existing = current.find((l) => l.variantId === hit.variantId);
      if (existing) {
        if (existing.quantity >= MAX_LINE_QUANTITY) {
          setCartNotice(`A line cannot exceed ${MAX_LINE_QUANTITY} units.`);
          return current;
        }
        return current.map((l) =>
          l.variantId === hit.variantId ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      if (current.length >= MAX_LINES_PER_SALE) {
        setCartNotice(`A sale cannot have more than ${MAX_LINES_PER_SALE} lines.`);
        return current;
      }
      return [
        ...current,
        {
          variantId: hit.variantId,
          productName: hit.productName,
          imageUrl: hit.imageUrl,
          sku: hit.sku,
          size: hit.size,
          colour: hit.colour,
          stockQuantity: hit.stockQuantity,
          quantity: 1,
          unitPriceMinor: hit.priceMinor,
          taxRateBp: hit.taxRateBp,
        },
      ];
    });
    setQuery("");
    searchInput.current?.focus();
  }, []);

  function setQuantity(variantId: string, quantity: number) {
    setCartNotice(null);
    if (quantity <= 0) {
      setCart((c) => c.filter((l) => l.variantId !== variantId));
      return;
    }
    if (quantity > MAX_LINE_QUANTITY) {
      setCartNotice(`A line cannot exceed ${MAX_LINE_QUANTITY} units.`);
      return;
    }
    setCart((c) => c.map((l) => (l.variantId === variantId ? { ...l, quantity } : l)));
  }

  const totals = computeSaleTotals(cart, 0);

  /**
   * The split tally, computed once.
   *
   * It used to be computed inside an IIFE in the middle of the split panel's JSX, which meant the
   * "Remaining" a cashier reads and the rule that decides whether Complete Sale may be pressed
   * were two separate expressions that merely happened to agree. They now cannot disagree,
   * because the readout and the button both read these.
   *
   * Amounts are entered in rupees and the server speaks minor units, so each row is rounded on
   * its own before being summed. Rounding the sum instead lets two halves of a paisa cancel out
   * into a total that no row actually paid.
   */
  const splitSumMinor = splitPayments.reduce(
    (acc, row) => acc + Math.round((row.amount ?? 0) * 100),
    0,
  );
  const splitRemainingMinor = totals.totalMinor - splitSumMinor;
  const splitOverMinor = splitSumMinor - totals.totalMinor;
  const splitHasCash = splitPayments.some((row) => row.method === "CASH" && (row.amount ?? 0) > 0);

  /**
   * Why Complete Sale is blocked, in the split case.
   *
   * These are the server's two rules, restated so the cashier is stopped at the button rather
   * than at a rejected request: `saleService` refuses a sum under the total, and refuses an
   * overpayment that no CASH row backs. The server still enforces both — this does not replace
   * that check, it just means the common mistakes never become a round trip.
   */
  const splitBlocked =
    method === "SPLIT" && (splitRemainingMinor > 0 || (splitOverMinor > 0 && !splitHasCash));

  /*
    Udhar (khata). The bill's total splits into what the customer pays now and what goes on
    their khata. The same rules the server enforces are stated here so the cashier is stopped
    at the button with a reason, not at a rejected request: a customer with a mobile number,
    a valid amount paid now, something actually left on khata, and the customer's credit limit.
  */
  const udharPaidValid = /^\d{0,8}(\.\d{0,2})?$/.test(udharPaidRaw.trim());
  const udharPaidMinor = udharPaidValid && udharPaidRaw.trim() !== "" ? Math.round(Number.parseFloat(udharPaidRaw) * 100) : 0;
  const udharOnKhataMinor = Math.max(0, totals.totalMinor - udharPaidMinor);
  const customerDueMinor = customer?.dueMinor ?? 0;
  const udharNewDueMinor = customerDueMinor + udharOnKhataMinor;
  const creditLimit = customer?.creditLimitMinor ?? null;
  const udharProblem: string | null =
    method !== "UDHAR"
      ? null
      : !customer
        ? "Add the customer to give udhar."
        : !customer.phone
          ? "This customer has no mobile number. Add one before giving udhar."
          : !udharPaidValid
            ? "Enter a valid amount paid now."
            : udharPaidMinor >= totals.totalMinor
              ? "Paid in full, so nothing goes on khata. Choose Cash, UPI or Card instead."
              : creditLimit !== null && udharNewDueMinor > creditLimit
                ? `Over the udhar limit of ${formatMinor(creditLimit)}. At most ${formatMinor(Math.max(0, creditLimit - customerDueMinor))} more can go on khata.`
                : null;
  const udharBlocked = method === "UDHAR" && cart.length > 0 && udharProblem !== null;

  function startNewSale() {
    setCart([]);
    setCustomer(null);
    setPicker({ open: false, mode: "search" });
    setUdharPaidRaw("");
    setUdharPayMethod("CASH");
    setMethod("CASH");
    setReference("");
    setAmountReceived(null);
    setCompleted(null);
    setReceipt(null);
    setReceiptFailed(false);
    setSaleError(null);
    setCartNotice(null);
    setQuery("");
    idempotencyKey.current = crypto.randomUUID();
    searchInput.current?.focus();
  }

  /**
   * Dismiss the success screen without starting a new sale.
   *
   * Deliberately does NOT clear the cart or rotate the idempotency key. The sale is already
   * recorded; leaving both in place means pressing Complete Sale again returns that same
   * sale as a duplicate rather than ringing a second one, which is the only safe thing an
   * accidental dismissal can do.
   */
  function dismissSuccess() {
    setCompleted(null);
    setReceipt(null);
    setReceiptFailed(false);
  }

  /**
   * Re-read the completed sale for the receipt.
   *
   * Tenant scoping is the server's, not ours: `/api/v1/sales/[id]` resolves the session and
   * returns the same 404 for another tenant's sale as for one that never existed.
   */
  async function loadReceipt(saleId: string) {
    try {
      const res = await fetch(`/api/v1/sales/${saleId}`);
      if (!res.ok) {
        setReceiptFailed(true);
        return;
      }
      const data = await res.json();
      setReceipt(data.sale as SaleReceipt);
    } catch {
      setReceiptFailed(true);
    }
  }

  async function handleHoldBill() {
    if (cart.length === 0 || submitting) return;
    setSubmitting(true);
    setSaleError(null);

    try {
      const res = await fetch("/api/v1/sales/held-bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          items: cart.map((c) => ({ variantId: c.variantId, quantity: c.quantity })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Failed to hold bill");
      }

      setCart([]);
      setCustomer(null);
      // Optional: Add a subtle flash or UI notice if needed, but the cart clearing is usually enough for POS.
    } catch (err: any) {
      setSaleError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetrieveBill(bill: HeldBill) {
    const newCart = bill.items.map(item => ({
      variantId: item.variant.id,
      productName: item.variant.product.name,
      imageUrl: item.variant.product.imageUrl,
      unitPriceMinor: item.variant.priceMinor,
      mrpMinor: item.variant.mrpMinor,
      taxRateBp: item.variant.taxRateBp,
      stockQuantity: null,
      sku: item.variant.sku,
      size: item.variant.size,
      colour: item.variant.colour,
      quantity: item.quantity,
    }));
    
    setCart(newCart);
    setRetrieveModalOpen(false);
  }

  async function completeSale() {
    if (cart.length === 0 || submitting) return;
    setSubmitting(true);
    setSaleError(null);

    // Validate amount received if cash
    if (method === "CASH" && amountReceived !== null && amountReceived * 100 < totals.totalMinor) {
      setSaleError("Amount received cannot be less than the total amount.");
      setSubmitting(false);
      return;
    }

    if (method === "SPLIT" && splitRemainingMinor > 0) {
      setSaleError("The split payments do not cover the total amount.");
      setSubmitting(false);
      return;
    }

    if (method === "UDHAR" && udharProblem) {
      setSaleError(udharProblem);
      setSubmitting(false);
      return;
    }

    try {
      /*
        A split sale sends `payments[]`; every other mode sends the single `payment` it always
        sent. Both fields are on `createSaleSchema`, and `saleService` unifies them, so this is
        the contract the server already had rather than a new one.

        What this replaces: the panel used to collect the rows and then throw them away, posting
        `{ method: "CASH" }` for the whole total whenever SPLIT was selected. The cashier saw two
        payments; the database recorded one, under the wrong method, with no reference. Rows with
        no amount typed are dropped rather than sent as zero, because the server requires at least
        1 minor unit per payment and an untouched row is not a payment anyone made.

        "UDHAR" sends `onAccountMinor` — the part going on the customer's khata — plus, when the
        customer paid something now, that one payment. A bill entirely on udhar sends no payment.
      */
      const splitRows =
        method === "SPLIT"
          ? splitPayments
              .filter((row) => (row.amount ?? 0) > 0)
              .map((row) => ({
                method: row.method,
                amountMinor: Math.round((row.amount as number) * 100),
                reference: row.reference.trim() ? row.reference.trim() : undefined,
              }))
          : null;

      const res = await fetch("/api/v1/sales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey.current,
          lines: cart.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
          customerId: customer?.id ?? null,
          ...(method === "UDHAR"
            ? {
                onAccountMinor: udharOnKhataMinor,
                ...(udharPaidMinor > 0
                  ? { payment: { method: udharPayMethod, amountMinor: udharPaidMinor } }
                  : {}),
              }
            : splitRows
              ? { payments: splitRows }
              : {
                  payment: {
                    method,
                    reference: reference.trim() ? reference.trim() : undefined,
                  },
                }),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSaleError(data?.error?.message ?? "Could not complete the sale.");
        return;
      }
      setCompleted({
        id: data.sale.id,
        billNumber: data.sale.billNumber,
        totalMinor: data.sale.totalMinor,
        paidMinor: data.sale.paidMinor,
        dueMinor: data.sale.dueMinor ?? Math.max(0, data.sale.totalMinor - data.sale.paidMinor),
        erpSyncStatus: data.sale.erpSyncStatus,
        duplicate: Boolean(data.duplicate),
      });
      // The sale has decremented stock: re-read the grid so the counts are current now,
      // not on the next manual refresh.
      setCatalogVersion((v) => v + 1);
      // Not awaited: the success screen must appear the moment the sale is real. The
      // receipt fills in behind it.
      setReceipt(null);
      setReceiptFailed(false);
      void loadReceipt(data.sale.id);
    } catch {
      setSaleError("We couldn't reach the server. Check the connection and press Complete sale again - this will not charge twice.");
    } finally {
      setSubmitting(false);
    }
  }

  const itemCount = cart.reduce((a, b) => a + b.quantity, 0);
  const customerArea = useRef<HTMLDivElement>(null);

  // F8 completes the sale, as the reference labels it. It presses the real button, so every
  // rule that disables the button (empty cart, unbalanced split, a sale in flight) applies.
  // F5 opens "New customer", as the action tile labels it.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "F5") return;
      event.preventDefault();
      openPicker(true, "new");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPicker]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "F8") return;
      const button = document.getElementById("complete-sale-btn") as HTMLButtonElement | null;
      if (!button || button.disabled) return;
      event.preventDefault();
      button.click();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {completed && (
        <SaleSuccess
          sale={completed}
          receipt={receipt}
          receiptFailed={receiptFailed}
          onNewSale={startNewSale}
          onDismiss={dismissSuccess}
        />
      )}
      <div className="flex h-[calc(100vh-68px)] w-full flex-col overflow-y-auto bg-slate-100/70 lg:flex-row lg:overflow-hidden print:hidden">
        {/* The till is a full-bleed workstation; the page heading is for assistive technology. */}
        <h1 className="sr-only">Point of Sale — {props.storeName}</h1>

        {/* ============================================================ products */}
        <section
          aria-label="Products"
          className="flex min-w-0 shrink-0 flex-col lg:min-h-0 lg:flex-1 lg:shrink"
        >
          {/* Entry modes, as the reference's underlined tabs. Only Products is built. */}
          <div role="tablist" aria-label="Product entry mode" className="flex shrink-0 items-end gap-8 border-b border-slate-200 bg-white px-5">
            <button
              type="button"
              role="tab"
              aria-selected="true"
              className="relative h-14 text-[17px] font-semibold text-sky-700 after:absolute after:inset-x-0 after:bottom-0 after:h-[2.5px] after:rounded-full after:bg-sky-600 [@media(max-height:820px)]:h-12"
            >
              Products
            </button>
            <button type="button" role="tab" aria-selected="false" disabled title="Barcode scan — not available yet" className="h-14 cursor-not-allowed text-[17px] font-medium text-slate-500 [@media(max-height:820px)]:h-12">
              Barcode Scan
            </button>
            <button type="button" role="tab" aria-selected="false" disabled title="Quick add — not available yet" className="h-14 cursor-not-allowed text-[17px] font-medium text-slate-500 [@media(max-height:820px)]:h-12">
              Quick Add
            </button>
          </div>

          {/* Search, filters, categories */}
          <div className="shrink-0 space-y-3 bg-white px-5 pb-3 pt-3.5 [@media(max-height:820px)]:space-y-2 [@media(max-height:820px)]:pt-2.5">
            <div className="flex items-center gap-2.5">
              <div className="relative flex-1">
                <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchInput}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search products"
                  placeholder="Search products by name, SKU, barcode..."
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-11 pr-10 text-[13px] text-slate-900 placeholder:text-slate-500 transition-colors hover:border-slate-300 focus:border-sky-500 focus:outline-none focus:ring-4 focus:ring-sky-500/15"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear product search"
                    onClick={() => {
                      setQuery("");
                      searchInput.current?.focus();
                    }}
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => searchInput.current?.focus()}
                aria-label="Scan barcode into search"
                title="Scan a barcode — the scanner types into search"
                className="amb-press flex size-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:border-sky-300 hover:text-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
              >
                <ScanLine aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>

            {/* Filters — every option comes from the catalogue, and each one narrows the grid. */}
            <div role="group" aria-label="Product filters" className="no-scrollbar flex items-center gap-2 overflow-x-auto">
              {(
                [
                  { key: "category", label: "All Categories", options: (facets?.categories ?? []).map((c) => ({ value: c.value, label: `${c.value} (${c.count})` })) },
                  { key: "brand", label: "All Brands", options: (facets?.brands ?? []).map((b) => ({ value: b.value, label: `${b.value} (${b.count})` })) },
                  { key: "size", label: "All Sizes", options: (facets?.sizes ?? []).map((v) => ({ value: v, label: v })) },
                  { key: "colour", label: "All Colours", options: (facets?.colours ?? []).map((v) => ({ value: v, label: v })) },
                  { key: "price", label: "Any Price", options: PRICE_BANDS.map((b) => ({ value: b.id, label: b.label })) },
                ] as { key: keyof PosFilters; label: string; options: { value: string; label: string }[] }[]
              ).map((f) => {
                const value = filters[f.key];
                return (
                  <label key={f.key} className="shrink-0">
                    <span className="sr-only">{f.label}</span>
                    <select
                      value={value}
                      onChange={(e) => setFilters((cur) => ({ ...cur, [f.key]: e.target.value }))}
                      className={`h-9 max-w-[180px] cursor-pointer rounded-lg border px-2.5 text-[12px] transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500/30 ${value ? "border-sky-400 bg-sky-50 font-medium text-sky-800" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}
                    >
                      <option value="">{f.label}</option>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
              {filtersActive && (
                <button
                  type="button"
                  onClick={() => setFilters(NO_FILTERS)}
                  className="cust-fade inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold text-sky-700 transition-colors hover:bg-sky-50"
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                  Clear filters
                </button>
              )}
            </div>

            {/* Category tiles: the tenant's real categories, with how many products each holds. */}
            <div role="group" aria-label="Categories" className="no-scrollbar -my-0.5 flex min-w-0 gap-2 overflow-x-auto px-0.5 py-0.5">
              {[{ value: "", count: facets?.categories.reduce((n, c) => n + c.count, 0) ?? 0 }, ...(facets?.categories ?? [])].map((cat, index) => {
                const active = filters.category.toLowerCase() === cat.value.toLowerCase();
                const look = cat.value ? categoryLook(cat.value, index) : { icon: LayoutGrid, tone: "text-sky-600" };
                return (
                  <button
                    type="button"
                    key={cat.value || "__all"}
                    aria-pressed={active}
                    onClick={() => setFilters((cur) => ({ ...cur, category: active && cat.value ? "" : cat.value }))}
                    className={`amb-press relative flex h-[74px] min-w-[84px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border px-3 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 [@media(max-height:820px)]:h-10 [@media(max-height:820px)]:flex-row [@media(max-height:820px)]:gap-1.5 ${active ? "border-sky-500 bg-sky-50 text-slate-900 ring-1 ring-sky-500" : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50/50"}`}
                  >
                    <look.icon aria-hidden="true" className={`h-6 w-6 ${look.tone} [@media(max-height:820px)]:h-4 [@media(max-height:820px)]:w-4`} fill="currentColor" fillOpacity={0.18} strokeWidth={1.8} />
                    <span className="max-w-[120px] truncate whitespace-nowrap">{cat.value || "All"}</span>
                    <span className="text-[10px] tabular-nums text-slate-500 [@media(max-height:820px)]:hidden">{cat.count} {cat.count === 1 ? "item" : "items"}</span>
                  </button>
                );
              })}
              {!facets &&
                [0, 1, 2, 3].map((n) => <div key={n} aria-hidden="true" className="amb-skeleton h-[74px] w-[84px] shrink-0 rounded-lg bg-slate-100 [@media(max-height:820px)]:h-10" />)}
            </div>
          </div>

          {/* Product grid — scrolls on its own so search and checkout stay put. */}
          <div className="h-[60vh] min-h-[320px] overflow-y-auto overscroll-contain px-5 py-3 lg:h-auto lg:min-h-0 lg:flex-1">
            {searchError && (
              <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">
                {searchError}
              </p>
            )}

            {/* Skeletons in the same footprint as the cards, so nothing shifts when results land. */}
            {searching && results.length === 0 && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3" aria-hidden="true">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="amb-skeleton flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5">
                    <div className="aspect-square w-full bg-slate-100" />
                    <div className="flex flex-col gap-2 p-3">
                      <div className="h-3 w-4/5 rounded bg-slate-100" />
                      <div className="h-3 w-3/5 rounded bg-slate-100" />
                      <div className="mt-1 h-4 w-1/2 rounded bg-slate-100" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <span className="sr-only" role="status" aria-live="polite">
              {searching ? "Searching products" : `${results.length} products listed`}
            </span>

            {!searching && results.length === 0 && !searchError && (
              <div className="cust-fade flex flex-col items-center justify-center py-16 text-center">
                <span aria-hidden="true" className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
                  <Search className="h-5 w-5" />
                </span>
                <p className="text-sm font-semibold text-slate-800">
                  {filtersActive ? "No products match these filters" : "No products match that search"}
                </p>
                <p className="mt-1 max-w-[280px] text-xs text-slate-600">
                  {filtersActive
                    ? "Try another category, size, colour or price — or clear the filters."
                    : "Try a different name, SKU or barcode — or clear the search to browse the full catalogue."}
                </p>
                {(filtersActive || term) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilters(NO_FILTERS);
                      setQuery("");
                    }}
                    className="mt-3 inline-flex h-9 items-center rounded-lg border border-sky-200 px-3 text-[13px] font-semibold text-sky-700 hover:bg-sky-50"
                  >
                    Show all products
                  </button>
                )}
              </div>
            )}

            <div className={`grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3 transition-opacity duration-150 ${searching && results.length > 0 ? "opacity-60" : ""}`} aria-busy={searching}>
              {results.map((hit, i) => {
                const stock = stockPill(hit.stockQuantity);
                return (
                  <button
                    type="button"
                    key={hit.variantId}
                    onClick={() => addToCart(hit)}
                    aria-label={`Add ${hit.productName} to cart, ${formatMinor(hit.priceMinor)}`}
                    className="pos-rise amb-lift amb-press group flex cursor-pointer flex-col rounded-lg border border-slate-200 bg-white p-1.5 text-left shadow-sm hover:border-sky-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                    style={{ ["--i" as string]: i }}
                  >
                    <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-slate-50">
                      {hit.imageUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={hit.imageUrl} alt={hit.productName} className="h-full w-full object-cover" />
                      ) : (
                        <Package aria-hidden="true" className="h-8 w-8 text-slate-300" />
                      )}
                      <span
                        aria-hidden="true"
                        className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-sky-600 text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                      >
                        <Plus className="h-4 w-4" />
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col px-1 pb-0.5 pt-2">
                      <p className="truncate text-[12px] font-medium text-slate-900">{hit.productName}</p>
                      <p className="mt-0.5 text-[14px] font-bold tabular-nums text-slate-900">{formatMinor(hit.priceMinor)}</p>
                      <p className="truncate text-[11px] text-slate-500">{hit.sku}</p>
                      {/* Four stock states, not two: null is unknown, not out of stock. Text pairs the dot. */}
                      <span className={`mt-1.5 inline-flex w-fit max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${stock.className}`}>
                        <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${stock.dot}`} />
                        <span className="truncate">{stock.text}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {/* The search endpoint returns at most 30 matches; say so rather than let a capped list read as the whole catalogue. */}
            {results.length >= 30 && (
              <p className="mt-3 text-center text-[12px] text-slate-500">
                Showing the first {results.length} products — search or pick a filter to find the rest.
              </p>
            )}
          </div>

          {/* Quick actions — not built yet, labelled as such. */}
          <div className="shrink-0 px-5 pb-4 pt-1 [@media(max-height:820px)]:pb-2">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <h2 className="mb-2.5 text-[15px] font-bold text-slate-900 [@media(max-height:820px)]:sr-only">Quick Actions</h2>
              <div role="group" aria-label="Quick actions" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                <ActionBtn icon={<PauseCircle className="h-5 w-5" />} label="Hold Bill" hotkey="F3" onClick={handleHoldBill} disabled={cart.length === 0 || submitting} />
                <ActionBtn icon={<History className="h-5 w-5" />} label="Retrieve Bill" hotkey="F4" onClick={() => setRetrieveModalOpen(true)} disabled={submitting} />
                <ActionBtn icon={<UserPlus className="h-5 w-5" />} label="New Customer" hotkey="F5" onClick={() => openPicker(true, "new")} />
                <ActionBtn icon={<BadgePercent className="h-5 w-5" />} label="Apply Offer" hotkey="F6" disabled />
                <ActionBtn icon={<UserCog className="h-5 w-5" />} label="Sales Person" hotkey="F7" disabled />
                <ActionBtn icon={<Ellipsis className="h-5 w-5" />} label="More Actions" disabled />
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================ checkout */}
        <aside
          aria-label="Checkout"
          className="relative flex h-[680px] w-full shrink-0 flex-col border-t border-slate-200 bg-white lg:h-full lg:w-[372px] lg:border-l lg:border-t-0 xl:w-[392px]"
        >
          <div className="flex shrink-0 items-end gap-6 border-b border-slate-200 px-4">
            <h2 className="relative flex h-11 items-center text-[15px] font-semibold text-sky-700 after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:rounded-full after:bg-sky-600">
              Cart ({itemCount})<span className="sr-only"> items in cart</span>
            </h2>
            <button
              type="button"
              onClick={() => openPicker(true, "search")}
              aria-expanded={picker.open}
              aria-controls="pos-customer-area"
              className={`relative h-11 cursor-pointer text-[15px] font-medium transition-colors hover:text-slate-800 ${picker.open ? "text-sky-700 after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:rounded-full after:bg-sky-600" : "text-slate-500"}`}
            >
              Customer
              {(customer?.dueMinor ?? 0) > 0 && (
                <span aria-hidden="true" className="absolute -right-2.5 top-2.5 h-2 w-2 rounded-full bg-amber-500" />
              )}
            </button>
          </div>

          <div ref={customerArea} id="pos-customer-area" className="shrink-0 border-b border-slate-100 px-3 py-2">
            <CustomerPicker
              customer={customer}
              onChange={setCustomer}
              open={picker.open}
              mode={picker.mode}
              onOpenChange={openPicker}
            />
          </div>

          {/* Cart lines — the only part of the column that scrolls. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {cartNotice && (
              <p role="alert" className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {cartNotice}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              {cart.map((line) => (
                <div
                  key={line.variantId}
                  className="amb-line-in group grid grid-cols-[40px_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-2.5 gap-y-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 transition-colors hover:border-slate-300"
                >
                  <div className="row-span-2 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                    {line.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={line.imageUrl} alt={line.productName} className="h-full w-full object-cover" />
                    ) : (
                      <Package aria-hidden="true" className="h-4 w-4 text-slate-300" />
                    )}
                  </div>
                  <p className="min-w-0 truncate text-[12px] font-semibold leading-tight text-slate-900">{line.productName}</p>
                  <div className="flex items-center justify-end gap-1">
                    <p className="text-[12.5px] font-semibold tabular-nums text-slate-900">
                      {formatMinor(line.unitPriceMinor * line.quantity)}
                    </p>
                    <button
                      type="button"
                      onClick={() => setQuantity(line.variantId, 0)}
                      aria-label={`Remove ${line.productName} from cart`}
                      className="amb-focus flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="min-w-0 truncate text-[11px] leading-tight text-slate-500">
                    <span className="font-semibold tabular-nums text-slate-700">{formatMinor(line.unitPriceMinor)}</span>
                    {" · "}
                    {line.sku}
                    {variantLabel(line) ? ` | ${variantLabel(line)}` : ""}
                  </p>
                  <div className="flex h-6 shrink-0 items-center justify-self-end overflow-hidden rounded-md border border-slate-200 bg-white text-slate-700">
                    <button
                      type="button"
                      onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                      aria-label={`Decrease quantity of ${line.productName}`}
                      className="amb-focus flex h-full w-6 cursor-pointer items-center justify-center text-sky-700 transition-colors hover:bg-slate-100 active:bg-slate-200"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span aria-live="polite" className="flex h-full w-8 items-center justify-center border-x border-slate-200 text-[12px] font-semibold tabular-nums">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                      aria-label={`Increase quantity of ${line.productName}`}
                      className="amb-focus flex h-full w-6 cursor-pointer items-center justify-center text-sky-700 transition-colors hover:bg-slate-100 active:bg-slate-200"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {cart.length === 0 && (
              <div className="flex h-full min-h-[96px] flex-col items-center justify-center px-6 text-center">
                <span aria-hidden="true" className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 [@media(max-height:820px)]:hidden">
                  <ScanLine className="h-5 w-5" />
                </span>
                <p className="text-sm font-semibold text-slate-800">Cart is empty</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">Scan a barcode or pick a product to start a sale.</p>
              </div>
            )}
          </div>

          {/* Checkout footer */}
          <div className="z-20 shrink-0 border-t border-slate-200 bg-white px-3 pb-3 pt-2">
            {/* Bill discounts have no backing rule yet: drawn as the reference has them, disabled. */}
            <div className="mb-2 flex items-center gap-1.5 [@media(max-height:999px)]:hidden">
              <input
                disabled
                placeholder="Add Discount"
                aria-label="Add discount (not available yet)"
                title="Bill discounts are not available yet"
                className="h-8 min-w-0 flex-1 cursor-not-allowed rounded-lg border border-slate-200 bg-white px-3 text-[12px] placeholder:text-slate-400"
              />
              <button type="button" disabled aria-label="Percent discount (not available yet)" className="h-8 w-8 cursor-not-allowed rounded-lg border border-slate-200 text-[12px] text-slate-400">%</button>
              <button type="button" disabled aria-label="Amount discount (not available yet)" className="h-8 w-8 cursor-not-allowed rounded-lg border border-slate-200 text-[12px] text-slate-400">₹</button>
              <button type="button" disabled title="Bill discounts are not available yet" className="h-8 cursor-not-allowed rounded-lg border border-slate-200 px-3 text-[12px] font-semibold text-slate-400">Apply</button>
            </div>

            <dl className="space-y-0.5 text-[12px]">
              <div className="flex items-center justify-between text-slate-600">
                <dt>Items ({itemCount})</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{formatMinor(totals.subtotalMinor)}</dd>
              </div>
              <div className={`flex items-center justify-between text-slate-600 ${totals.discountMinor > 0 ? "" : "[@media(max-height:820px)]:hidden"}`}>
                <dt>Discount</dt>
                <dd className={totals.discountMinor > 0 ? "font-medium tabular-nums text-emerald-700" : "text-slate-400"}>
                  {totals.discountMinor > 0 ? `−${formatMinor(totals.discountMinor)}` : "—"}
                </dd>
              </div>
              {totals.discountMinor > 0 && (
                <div className="flex items-center justify-between text-slate-600">
                  <dt>Subtotal</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">{formatMinor(totals.subtotalMinor - totals.discountMinor)}</dd>
                </div>
              )}
              <div className="flex items-center justify-between text-slate-600">
                <dt>GST / Tax</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{formatMinor(totals.taxMinor)}</dd>
              </div>
              <div className="!mt-1.5 flex items-baseline justify-between rounded-md bg-sky-50 px-2 py-1">
                <dt className="text-[14px] font-bold text-slate-900">Total Amount</dt>
                <dd>
                  <span key={totals.totalMinor} className="pos-bump text-[16px] font-bold tabular-nums tracking-tight text-slate-900">
                    {formatMinor(totals.totalMinor)}
                  </span>
                </dd>
              </div>
            </dl>

            <p className="sr-only">Payment Mode</p>
            <div role="group" aria-label="Payment method" className="mt-2 flex gap-1">
              {PAYMENT_METHODS.map((m) => {
                const Icon = PAYMENT_ICONS[m.value];
                const selected = method === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setMethod(m.value);
                      if (m.value !== "SPLIT") setAmountReceived(null);
                      if (m.value === "UDHAR" && !customer) openPicker(true, "search");
                    }}
                    className={`amb-focus flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border px-1 text-[11.5px] font-medium transition-colors ${selected ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"}`}
                  >
                    <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Cash: amount received, quick tender, balance */}
            {method === "CASH" && (
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="amount-received" className="text-[12px] font-medium text-slate-700">
                    Amount Received
                  </label>
                  <div className="relative">
                    <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
                      ₹
                    </span>
                    <input
                      id="amount-received"
                      type="number"
                      value={amountReceived ?? ""}
                      onChange={(e) => setAmountReceived(e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder="0.00"
                      inputMode="decimal"
                      className="h-8 w-32 rounded-lg border border-slate-200 bg-white pl-7 pr-2.5 text-right text-[14px] font-bold tabular-nums text-slate-900 outline-none transition-colors placeholder:font-normal placeholder:text-slate-400 focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {tenderSuggestions(totals.totalMinor).map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setAmountReceived(amount)}
                      className="amb-press amb-focus h-7 cursor-pointer rounded-md border border-sky-200 bg-white text-[11.5px] font-semibold tabular-nums text-sky-700 transition-colors hover:bg-sky-50"
                    >
                      ₹{amount.toLocaleString("en-IN")}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAmountReceived(totals.totalMinor / 100)}
                    className="amb-press amb-focus h-7 cursor-pointer rounded-md border border-slate-200 bg-white text-[11.5px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Exact
                  </button>
                </div>
                {/* Short while under the total, change when over, settled when exact. Words carry the meaning, not colour. */}
                {(() => {
                  const tenderedMinor = amountReceived == null ? null : Math.round(amountReceived * 100);
                  const deltaMinor = tenderedMinor == null ? null : tenderedMinor - totals.totalMinor;
                  const label = deltaMinor == null ? "Balance" : deltaMinor > 0 ? "Change due" : deltaMinor < 0 ? "Short by" : "Balance";
                  const tone = deltaMinor == null ? "text-slate-400" : deltaMinor > 0 ? "text-emerald-600" : deltaMinor < 0 ? "text-rose-600" : "text-emerald-600";
                  return (
                    <div className="flex items-center justify-between" aria-live="polite">
                      <span className="text-[12px] font-medium text-slate-700">{label}</span>
                      <span className={`text-[14px] font-bold tabular-nums ${tone}`}>
                        {deltaMinor == null ? "Enter amount" : deltaMinor === 0 ? formatMinor(0) : formatMinor(Math.abs(deltaMinor))}
                      </span>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Split payment */}
            {method === "SPLIT" && (
              <div className="no-scrollbar mt-3 flex max-h-[176px] flex-col gap-2 overflow-y-auto">
                {splitPayments.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5">
                    {/* Labelled by row number: position is what distinguishes one payment from another. */}
                    <select
                      aria-label={`Payment ${i + 1} method`}
                      value={p.method}
                      onChange={(e) => setSplitPayments((curr) => curr.map((x) => (x.id === p.id ? { ...x, method: e.target.value as SplitMethod } : x)))}
                      className="h-8 w-20 cursor-pointer rounded-lg border-none bg-slate-100 px-1.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="CASH">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="CARD">Card</option>
                    </select>
                    {p.method !== "CASH" ? (
                      <input
                        aria-label={`Payment ${i + 1} reference`}
                        placeholder="Ref (Opt)"
                        value={p.reference}
                        onChange={(e) => setSplitPayments((curr) => curr.map((x) => (x.id === p.id ? { ...x, reference: e.target.value } : x)))}
                        className="h-8 w-16 flex-1 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
                      />
                    ) : (
                      <div className="w-16 flex-1" />
                    )}
                    <input
                      type="number"
                      aria-label={`Payment ${i + 1} amount`}
                      placeholder="Amt"
                      value={p.amount ?? ""}
                      onChange={(e) => setSplitPayments((curr) => curr.map((x) => (x.id === p.id ? { ...x, amount: e.target.value ? parseFloat(e.target.value) : null } : x)))}
                      className="h-8 w-[78px] rounded-lg border border-slate-200 px-2 text-right text-xs font-bold tabular-nums outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
                    />
                    <button
                      type="button"
                      aria-label={`Remove payment ${i + 1}`}
                      onClick={() => setSplitPayments((curr) => curr.filter((x) => x.id !== p.id))}
                      className="flex h-8 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <X aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setSplitPayments((curr) => [...curr, { id: Date.now().toString(), method: "CASH", amount: null, reference: "" }])}
                  className="h-9 w-full shrink-0 rounded-xl border border-dashed border-blue-300 bg-blue-50/70 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                >
                  + Add Payment Row
                </button>
                {/* Reads the hoisted tally, so this number and the button can never disagree. */}
                <div className="flex shrink-0 items-center justify-between px-1 text-[13px]">
                  <span className="font-semibold text-slate-600">{splitRemainingMinor > 0 ? "Remaining" : "Balance"}</span>
                  <span data-testid="split-remaining" className={`font-bold tabular-nums ${splitRemainingMinor > 0 ? "text-amber-700" : "text-slate-900"}`}>
                    {splitRemainingMinor > 0
                      ? formatMinor(splitRemainingMinor)
                      : splitOverMinor > 0 && splitHasCash
                        ? formatMinor(splitOverMinor)
                        : "—"}
                  </span>
                </div>
              </div>
            )}

            {/* Udhar: paid now + on khata, against the customer's existing due and limit. */}
            {method === "UDHAR" && (
              <div className="amb-fade-in mt-2 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/60 p-2" data-testid="udhar-panel">
                {!customer ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] text-amber-900">Udhar needs a customer with a mobile number.</p>
                    <button
                      type="button"
                      onClick={() => openPicker(true, "search")}
                      className="amb-press h-7 shrink-0 cursor-pointer rounded-md bg-white px-2.5 text-[11.5px] font-semibold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100"
                    >
                      Add customer
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="udhar-paid" className="text-[12px] font-medium text-slate-700">
                        Paid now
                      </label>
                      <div className="flex items-center gap-1">
                        <select
                          aria-label="Paid now by"
                          value={udharPayMethod}
                          onChange={(e) => setUdharPayMethod(e.target.value as SplitMethod)}
                          className="h-8 cursor-pointer rounded-lg border border-slate-200 bg-white px-1.5 text-[11.5px] font-semibold text-slate-700 outline-none focus:border-sky-500"
                        >
                          <option value="CASH">Cash</option>
                          <option value="UPI">UPI</option>
                          <option value="CARD">Card</option>
                        </select>
                        <div className="relative">
                          <span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
                            ₹
                          </span>
                          <input
                            id="udhar-paid"
                            inputMode="decimal"
                            value={udharPaidRaw}
                            onChange={(e) => setUdharPaidRaw(e.target.value.replace(/[^\d.]/g, ""))}
                            placeholder="0"
                            aria-invalid={!udharPaidValid || undefined}
                            className="h-8 w-24 rounded-lg border border-slate-200 bg-white pl-6 pr-2 text-right text-[13px] font-bold tabular-nums text-slate-900 outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15"
                          />
                        </div>
                      </div>
                    </div>
                    <dl className="space-y-0.5 text-[12px]" aria-live="polite">
                      <div className="flex justify-between">
                        <dt className="font-semibold text-amber-900">On khata (udhar)</dt>
                        <dd className="font-bold tabular-nums text-amber-900" data-testid="udhar-on-khata">{formatMinor(udharOnKhataMinor)}</dd>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <dt>Already owes</dt>
                        <dd className="tabular-nums">{formatMinor(customerDueMinor)}</dd>
                      </div>
                      <div className="flex justify-between text-slate-800">
                        <dt className="font-medium">Total due after this bill</dt>
                        <dd className="font-semibold tabular-nums">{formatMinor(udharNewDueMinor)}</dd>
                      </div>
                      {creditLimit !== null && (
                        <div className="flex justify-between text-slate-500">
                          <dt>Udhar limit</dt>
                          <dd className="tabular-nums">{formatMinor(creditLimit)}</dd>
                        </div>
                      )}
                    </dl>
                  </>
                )}
                {udharProblem && customer && cart.length > 0 && (
                  <p className="text-[11.5px] font-medium text-rose-700">{udharProblem}</p>
                )}
              </div>
            )}

            {saleError && (
              <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {saleError}
              </p>
            )}

            <button
              onClick={completeSale}
              id="complete-sale-btn"
              type="button"
              disabled={submitting || cart.length === 0 || splitBlocked || udharBlocked}
              aria-keyshortcuts="F8"
              className="amb-press amb-focus mt-2 flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-white shadow-sm shadow-emerald-700/20 transition-[background-color,opacity] hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:bg-emerald-600 [@media(max-height:820px)]:mt-2 [@media(max-height:820px)]:h-11"
            >
              {submitting ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
              ) : (
                <ShoppingCart aria-hidden="true" className="h-5 w-5" />
              )}
              <span className="text-[15px] font-semibold">{submitting ? "Completing..." : "Complete Sale (F8)"}</span>
            </button>
          </div>
        </aside>
      </div>

      <RetrieveBillModal 
        open={retrieveModalOpen} 
        onClose={() => setRetrieveModalOpen(false)} 
        onRetrieve={handleRetrieveBill} 
      />
    </>
  );
}

function ActionBtn({
  icon,
  label,
  hotkey,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hotkey?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? `${label} — not available yet` : undefined}
      aria-keyshortcuts={hotkey}
      className={`flex h-[78px] min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1 text-center text-[12px] leading-tight transition-colors [@media(max-height:820px)]:h-12 [@media(max-height:820px)]:flex-row [@media(max-height:820px)]:gap-1.5 ${disabled ? "cursor-not-allowed border-slate-200 bg-white text-slate-500" : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50"}`}
    >
      <span aria-hidden="true" className={disabled ? "text-sky-600/60" : "text-sky-600"}>{icon}</span>
      <span className="truncate">{label}</span>
      {hotkey && <span className="text-[11px] text-slate-400 [@media(max-height:820px)]:hidden">({hotkey})</span>}
    </button>
  );
}

/**
 * The receipt as plain text, for WhatsApp and e-mail. Built from the re-read sale — the same
 * figures the printed slip shows — so a shared receipt can never disagree with the bill.
 */
function receiptText(r: SaleReceipt): string {
  return [
    r.storeName,
    `Bill ${r.billNumber} · ${formatDateTime(new Date(r.completedAt))}`,
    "",
    ...r.items.map((i) => `${i.quantity} × ${i.name} — ${formatMinor(i.lineTotalMinor)}`),
    "",
    `Total: ${formatMinor(r.totalMinor)}`,
    r.payments.length > 0
      ? `Paid: ${r.payments.map((p) => `${p.method} ${formatMinor(p.amountMinor)}`).join(", ")}`
      : "Paid: —",
    ...(r.totalMinor > r.paidMinor ? [`On khata (udhar): ${formatMinor(r.totalMinor - r.paidMinor)}`] : []),
    "",
    "Thank you for shopping with us!",
  ].join("\n");
}

function SaleSuccess(props: {
  sale: CompletedSale;
  receipt: SaleReceipt | null;
  receiptFailed: boolean;
  onNewSale: () => void;
  onDismiss: () => void;
}) {
  const { sale, receipt, receiptFailed } = props;
  const dialog = useRef<HTMLDivElement>(null);
  const printAction = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  /*
    Focus, in two steps rather than one.

    The print button is the primary action, but it is disabled until the receipt has been
    re-read, and a disabled button cannot take focus — aiming at it on mount would leave
    focus on <body>, outside the dialog, which is the exact failure this is meant to avoid.
    So focus goes to the dialog itself first (it is `tabIndex={-1}` for this), and moves to
    the print button the moment that button becomes real.
  */
  useEffect(() => {
    dialog.current?.focus();
  }, []);

  useEffect(() => {
    if (receipt) printAction.current?.focus();
  }, [receipt]);

  /*
    Escape dismisses, and Tab cannot leave. A sale has just been recorded and the receipt is
    the only thing on screen worth acting on; letting focus wander into the dimmed till
    behind would offer controls that are not reachable by mouse.
  */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        props.onDismiss();
        return;
      }
      // F3 prints and F2 starts the next sale — the reference's labels, made real.
      if (e.key === "F3") {
        e.preventDefault();
        if (props.receipt) window.print();
        return;
      }
      if (e.key === "F2") {
        e.preventDefault();
        props.onNewSale();
        return;
      }
      if (e.key !== "Tab" || !dialog.current) return;

      const focusable = dialog.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  /*
    Change due, derived from the tenders rather than from `Sale.paidMinor`.

    `paidMinor` looks like the obvious operand and is the wrong one: `saleService` assigns it
    `totals.totalMinor` unconditionally, so `paidMinor - totalMinor` is always exactly zero
    even on a sale the cashier was handed more cash for. The overpayment is real and it is
    recorded — on the `SalePayment` rows, which is where F9 puts it — so what was handed over
    is the sum of those rows. Reading it there changes nothing about how a sale is written;
    it just reads the number from the column that actually holds it.

    Shown only when positive, so an exactly-settled sale carries no ₹0.00 row that means
    nothing at the counter. Before the receipt arrives the fallback is the completion
    response's own figures, which yield zero — no flash of a wrong number.

    Known limit, and F9's to decide rather than this screen's: a single-tender cash sale does
    not send an amount, so the server records the tender as the total and no change can be
    derived. Change therefore appears on split tenders, where the amount handed over is
    explicitly recorded.
  */
  const totalMinor = receipt?.totalMinor ?? sale.totalMinor;
  // What had to be paid now: the total, less anything put on khata.
  const payableMinor = receipt?.paidMinor ?? sale.paidMinor;
  const onKhataMinor = Math.max(0, totalMinor - payableMinor);
  const tenderedMinor = receipt
    ? receipt.payments.reduce((n, p) => n + p.amountMinor, 0)
    : sale.paidMinor;
  const changeMinor = tenderedMinor - payableMinor;

  // Units sold, not lines. A cashier handing over three of one shirt has sold three items.
  const itemCount = receipt ? receipt.items.reduce((n, i) => n + i.quantity, 0) : null;

  const erpPending = (receipt?.erpSyncStatus ?? sale.erpSyncStatus) !== "SYNCED";

  function printReceipt() {
    window.print();
  }

  /**
   * Copy the bill number — the one value a cashier reads back over a phone or writes on a
   * bag. `navigator.clipboard` is unavailable on an insecure origin, so a failure is
   * swallowed to leave the icon unchanged rather than claiming a copy that did not happen.
   */
  async function copyBillNumber() {
    try {
      await navigator.clipboard.writeText(sale.billNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission or no secure context. The number is on screen regardless.
    }
  }

  return (
    /*
      Two elements rather than one, and not for decoration: a flex child that is taller than
      its scrolling parent gets its overflow clipped at the TOP when the parent centres it, so
      a single `fixed inset-0 flex items-center overflow-y-auto` loses the heading and the
      close control on a phone. The scroll lives on the outer box; the centring lives on an
      inner box with `min-h-full`, which can grow past the viewport instead of being cut.
    */
    <div
      className="amb-fade-in fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-sm print:static print:block print:overflow-visible print:bg-transparent print:backdrop-blur-none"
      data-testid="sale-success"
    >
      <div className="flex min-h-full items-center justify-center p-4 print:block print:p-0">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-success-heading"
        tabIndex={-1}
        /* `amb-pop-in` replaces `animate-in fade-in zoom-in`, which rendered nothing:
           tailwindcss-animate is not installed and tailwind.config has `plugins: []`. */
        className="amb-pop-in relative grid w-full max-w-[770px] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5 focus:outline-none lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] print:block print:max-w-none print:animate-none print:rounded-none print:shadow-none"
      >
        {/*
          The close control belongs to the dialog, not to either column. At `lg` that puts it
          in the receipt's top corner exactly as the reference draws it; below `lg` the columns
          stack and it stays at the top of the dialog, where it is reachable without scrolling
          past the whole receipt first.
        */}
        <button
          type="button"
          onClick={props.onDismiss}
          aria-label="Close and return to the till"
          data-testid="success-close"
          className="absolute right-3 top-3 z-10 rounded-full bg-white/80 p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600 print:hidden"
        >
          <X className="h-4 w-4" />
        </button>

        {/* ---------- Confirmation + actions ---------- */}
        <div className="flex flex-col justify-center p-6 print:hidden">
          <div className="relative mx-auto mb-4 h-28 w-40" aria-hidden="true">
            {/* Confetti, as the reference draws it: decoration only. */}
            {[
              ["left-3 top-6", "bg-emerald-500", "size-2"],
              ["left-6 top-12", "bg-violet-400", "size-1.5"],
              ["left-0 top-[78px]", "bg-sky-200", "size-1.5"],
              ["left-10 top-[86px]", "bg-sky-500", "size-2 rotate-45 rounded-[2px]"],
              ["right-8 top-0", "bg-blue-600", "size-2 rotate-45 rounded-[2px]"],
              ["right-3 top-9", "bg-sky-300", "size-1.5"],
              ["right-6 top-[60px]", "bg-violet-300", "size-1.5"],
              ["right-0 top-[76px]", "bg-amber-400", "size-2"],
            ].map(([pos, colour, size]) => (
              <span key={pos} className={`absolute rounded-full ${pos} ${colour} ${size}`} />
            ))}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="pos-check flex h-24 w-24 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <Check className="h-12 w-12" strokeWidth={3} />
              </div>
            </div>
          </div>

          <h2
            id="sale-success-heading"
            className="text-center text-[30px] font-bold tracking-tight text-slate-900"
          >
            Sale Completed!
          </h2>
          <p className="mt-1 text-center text-[16px] text-slate-500">Bill generated successfully</p>

          {sale.duplicate && (
            <p className="mt-4 rounded-lg bg-amber-50 p-2 text-center text-[12px] text-amber-800">
              Duplicate submission. The original sale was retrieved — nothing was charged twice.
            </p>
          )}

          {/* Transaction summary */}
          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl bg-slate-50 px-4 py-3.5">
            <div>
              <dt className="text-[12px] text-slate-500">
                Bill No.
              </dt>
              <dd
                className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold text-slate-900"
                data-testid="success-bill-number"
              >
                {sale.billNumber}
                <button
                  type="button"
                  onClick={copyBillNumber}
                  aria-label={`Copy bill number ${sale.billNumber}`}
                  data-testid="success-copy-bill"
                  className="rounded p-0.5 text-slate-400 transition-colors hover:bg-white hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-600"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                {/* Announced rather than only shown — the icon swap is invisible to a screen
                    reader, and the copy is the whole point of pressing it. */}
                <span aria-live="polite" className="sr-only">
                  {copied ? "Bill number copied" : ""}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-slate-500">
                Date &amp; Time
              </dt>
              <dd className="mt-0.5 whitespace-nowrap text-[14px] font-semibold text-slate-900">
                {receipt ? formatDateTime(new Date(receipt.completedAt)) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-slate-500">
                Total
              </dt>
              <dd
                className="mt-0.5 text-[16px] font-bold text-slate-900"
                data-testid="success-total"
              >
                {formatMinor(totalMinor)}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-slate-500">
                Items
              </dt>
              <dd
                className="mt-0.5 text-[16px] font-bold text-slate-900"
                data-testid="success-item-count"
              >
                {itemCount ?? "—"}
              </dd>
            </div>
          </dl>

          {onKhataMinor > 0 && (
            <div
              className="mt-3 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
              data-testid="success-on-khata"
            >
              <span className="text-[13px] font-semibold text-amber-900">
                On khata (udhar)
                {receipt?.customer ? <span className="block text-[11.5px] font-normal">{receipt.customer.name}</span> : null}
              </span>
              <span className="text-xl font-bold text-amber-800">{formatMinor(onKhataMinor)}</span>
            </div>
          )}

          {changeMinor > 0 && (
            <div
              className="mt-3 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3"
              data-testid="success-change-due"
            >
              <span className="text-[13px] font-semibold text-emerald-900">Change due</span>
              <span className="text-xl font-bold text-emerald-700">
                {formatMinor(changeMinor)}
              </span>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3.5">
            <button
              ref={printAction}
              type="button"
              onClick={printReceipt}
              disabled={!receipt}
              aria-keyshortcuts="F3"
              data-testid="success-print"
              className="amb-press inline-flex h-[52px] w-full items-center justify-center gap-2.5 rounded-lg bg-sky-600 text-[16px] font-semibold text-white shadow-sm shadow-sky-700/25 transition-colors hover:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Printer className="h-5 w-5" />
              {receipt ? "Print Receipt (F3)" : "Preparing receipt..."}
            </button>

            {/* "Save as PDF" is the browser's own print destination: the receipt's print styles
                make that file the receipt, with no PDF service behind it. */}
            <button
              type="button"
              onClick={printReceipt}
              disabled={!receipt}
              title="Opens the print dialog — choose “Save as PDF”"
              data-testid="success-download-pdf"
              className="inline-flex h-[52px] w-full items-center justify-center gap-2.5 rounded-lg border border-slate-200 bg-white text-[15px] font-medium text-slate-800 transition-colors hover:border-sky-200 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-white"
            >
              <Download className="h-5 w-5 text-sky-600" />
              Download PDF
            </button>

            <div className="grid grid-cols-2 gap-3.5">
              {receipt ? (
                <a
                  href={`https://wa.me/${(receipt.customer?.phone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(receiptText(receipt))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="success-share-whatsapp"
                  className="inline-flex h-[52px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-[14px] font-medium text-slate-800 transition-colors hover:border-emerald-200 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  <MessageCircle className="h-5 w-5 text-emerald-600" />
                  Share via WhatsApp
                </a>
              ) : (
                <button type="button" disabled className="inline-flex h-[52px] cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-[14px] font-medium text-slate-400">
                  <MessageCircle className="h-5 w-5" />
                  Share via WhatsApp
                </button>
              )}
              {receipt ? (
                <a
                  href={`mailto:?subject=${encodeURIComponent(`Receipt ${receipt.billNumber} — ${receipt.storeName}`)}&body=${encodeURIComponent(receiptText(receipt))}`}
                  data-testid="success-email-receipt"
                  className="inline-flex h-[52px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-[14px] font-medium text-slate-800 transition-colors hover:border-sky-200 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                >
                  <Mail className="h-5 w-5 text-sky-600" />
                  Email Receipt
                </a>
              ) : (
                <button type="button" disabled className="inline-flex h-[52px] cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-[14px] font-medium text-slate-400">
                  <Mail className="h-5 w-5" />
                  Email Receipt
                </button>
              )}
            </div>

            <Link
              href={`/sales/${sale.id}`}
              data-testid="success-bill-details"
              className="inline-flex h-[52px] w-full items-center justify-center gap-2.5 rounded-lg border border-slate-200 bg-white text-[15px] font-medium text-slate-800 transition-colors hover:border-sky-200 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              <FileText className="h-5 w-5 text-sky-600" />
              View Bill Details
            </Link>

            <button type="button" disabled title="Returns and exchanges are not available yet" className="inline-flex h-[52px] w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-lg border border-slate-200 bg-white text-[15px] font-medium text-slate-400">
              <RefreshCcw className="h-5 w-5" />
              Return / Exchange
              <span className="sr-only"> (not available yet)</span>
            </button>

            <button
              type="button"
              onClick={props.onNewSale}
              aria-keyshortcuts="F2"
              data-testid="success-new-sale"
              className="amb-press inline-flex h-[52px] w-full items-center justify-center gap-2.5 rounded-lg border border-slate-200 bg-white text-[15px] font-semibold text-sky-700 transition-colors hover:border-sky-200 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              <Plus className="h-5 w-5" />
              New Sale (F2)
            </button>
          </div>

          {/*
            ERPNext is not connected, so PENDING is the truthful state and the only thing this
            screen may say about it. It must never read as "posted" — schema.prisma says so at
            the column, and the receipt deliberately carries no invoice number for the same
            reason: AMBURAX allocates a bill number, ERPNext allocates invoice numbers, and
            only one of those has happened.
          */}
          {erpPending && (
            <p
              className="mt-4 text-center text-[11px] text-slate-500"
              data-testid="success-erp-status"
            >
              Sync pending
            </p>
          )}
        </div>

        {/* ---------- Receipt ---------- */}
        <div
          id="sale-receipt"
          className="relative border-t border-slate-200 bg-slate-100 p-4 sm:p-5 lg:border-l lg:border-t-0 print:border-0 print:bg-white print:p-0"
        >
          {receipt ? (
            <div
              className="pos-receipt-paper mx-auto max-w-[330px] bg-white px-5 pb-7 pt-8 text-[12px] text-slate-700 shadow-sm print:max-w-none print:shadow-none"
            >
              {/* Header — store identity. No GSTIN: AMBURAX has no store-level tax
                  registration field, and a tenant-wide taxId is not one. */}
              <div className="text-center">
                <p className="text-[20px] font-bold tracking-tight text-slate-900">
                  {receipt.storeName}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">Store {receipt.storeCode}</p>
                <p className="mt-1.5 text-[11px] leading-snug text-slate-600">
                  {receipt.storeAddressLine}
                  <br />
                  {receipt.storeCity}, {receipt.storeState}
                  {receipt.storePostalCode ? ` — ${receipt.storePostalCode}` : ""}
                </p>
              </div>

              <dl className="mt-4 space-y-1 border-t border-dashed border-slate-300 pt-3">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Bill No.</dt>
                  <dd className="font-semibold text-slate-900">{receipt.billNumber}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Date &amp; Time</dt>
                  <dd className="text-slate-900">
                    {formatDateTime(new Date(receipt.completedAt))}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Cashier</dt>
                  <dd className="text-slate-900">{receipt.cashierName}</dd>
                </div>
                {receipt.customer && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Customer</dt>
                    <dd className="text-right text-slate-900" data-testid="receipt-customer">
                      {receipt.customer.name}
                      {receipt.customer.phone ? (
                        <span className="block text-[11px] text-slate-500">
                          {receipt.customer.phone}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                )}
              </dl>

              <table className="mt-3 w-full border-t border-dashed border-slate-300 pt-2 text-left">
                <caption className="sr-only">Items sold on this bill</caption>
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                    <th scope="col" className="py-1.5 font-medium">
                      Item
                    </th>
                    <th scope="col" className="py-1.5 text-center font-medium">
                      Qty
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      Price
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody data-testid="receipt-items">
                  {receipt.items.map((item) => {
                    // Size and colour are live variant reads — see the note in saleQueries.ts.
                    const variant = [item.size, item.colour].filter(Boolean).join(" / ");
                    return (
                      <tr key={item.id} className="align-top">
                        <td className="py-1.5 pr-2">
                          <span className="block text-slate-900">{item.name}</span>
                          <span className="block text-[10px] text-slate-500">
                            {item.sku}
                            {variant ? ` | ${variant}` : ""}
                          </span>
                        </td>
                        <td className="py-1.5 text-center text-slate-900">{item.quantity}</td>
                        <td className="py-1.5 text-right text-slate-700">
                          {formatMinor(item.unitPriceMinor)}
                        </td>
                        <td className="py-1.5 text-right font-medium text-slate-900">
                          {formatMinor(item.lineTotalMinor)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <dl className="mt-3 space-y-1 border-t border-dashed border-slate-300 pt-3">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Subtotal</dt>
                  <dd className="text-slate-900">{formatMinor(receipt.subtotalMinor)}</dd>
                </div>
                {/*
                  Conditional, and labelled "Discount" rather than "Item discount": the only
                  discount this product can record is the order-level `Sale.discountMinor`.
                  Per-line POS discounting does not exist, so naming one would describe a
                  mechanism that is not there.
                */}
                {receipt.discountMinor > 0 && (
                  <div className="flex justify-between gap-3" data-testid="receipt-discount">
                    <dt className="text-slate-500">Discount</dt>
                    <dd className="text-emerald-700">−{formatMinor(receipt.discountMinor)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Tax</dt>
                  <dd className="text-slate-900">{formatMinor(receipt.taxMinor)}</dd>
                </div>
                <div className="mt-1 flex justify-between gap-3 border-t border-slate-300 pt-2 text-[13px] font-bold text-slate-900">
                  <dt>
                    Total ({receipt.items.reduce((n, i) => n + i.quantity, 0)} items)
                  </dt>
                  <dd data-testid="receipt-total">{formatMinor(receipt.totalMinor)}</dd>
                </div>
              </dl>

              <div className="mt-3 border-t border-dashed border-slate-300 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Payment details
                </p>
                <ul className="mt-1.5 space-y-1" data-testid="receipt-payments">
                  {receipt.payments.map((p, i) => (
                    <li key={`${p.method}-${i}`} className="flex justify-between gap-3">
                      <span className="text-slate-700">
                        {i + 1}. {p.method}
                        {p.reference ? (
                          <span className="block text-[10px] text-slate-500">{p.reference}</span>
                        ) : null}
                        {/* Surfaced only when it is not confirmed — a till must never imply a
                            tender settled when the row says otherwise. */}
                        {p.status !== "CONFIRMED" ? (
                          <span className="block text-[10px] text-amber-700">
                            {p.status.toLowerCase()}
                          </span>
                        ) : null}
                      </span>
                      <span className="font-medium text-slate-900">
                        {formatMinor(p.amountMinor)}
                      </span>
                    </li>
                  ))}
                </ul>
                {onKhataMinor > 0 && (
                  <div className="mt-2 flex justify-between gap-3 border-t border-dashed border-slate-300 pt-2 font-semibold text-slate-900" data-testid="receipt-on-khata">
                    <span>On khata (udhar)</span>
                    <span>{formatMinor(onKhataMinor)}</span>
                  </div>
                )}
                {changeMinor > 0 && (
                  <div className="mt-2 flex justify-between gap-3 border-t border-dashed border-slate-300 pt-2 font-semibold text-slate-900">
                    <span>Change</span>
                    <span data-testid="receipt-change">{formatMinor(changeMinor)}</span>
                  </div>
                )}
              </div>

              <p className="mt-5 text-center font-mono text-[13px] font-semibold tracking-[0.3em] text-slate-900">
                {receipt.billNumber}
              </p>
              <p className="mt-1 text-center text-[10px] text-slate-500">
                {erpPending ? "Sync pending" : "Synced"}
              </p>
            </div>
          ) : receiptFailed ? (
            <div className="flex h-full min-h-[12rem] items-center justify-center px-6 text-center">
              <p className="text-[12px] text-slate-600" data-testid="receipt-unavailable">
                The sale is recorded and the bill number above is final. The printable receipt
                could not be loaded — open{" "}
                <Link href={`/sales/${sale.id}`} className="font-semibold text-blue-700 underline">
                  Bill Details
                </Link>{" "}
                to print it.
              </p>
            </div>
          ) : (
            <div className="flex h-full min-h-[12rem] items-center justify-center">
              <p className="text-[12px] text-slate-500">Loading receipt...</p>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
