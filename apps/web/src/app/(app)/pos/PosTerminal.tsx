"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  computeSaleTotals,
  type ApparelSlab,
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
  Camera,
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
  Coins,
  Award,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { formatDateTime } from "@/app/(app)/sales/formatDateTime";
import { CustomerPicker, type CustomerHit, type PickerMode } from "./CustomerPicker";
import { RetrieveBillModal, type HeldBill } from "./RetrieveBillModal";
import { ApplyOfferModal } from "./ApplyOfferModal";
import { SalesPersonModal, type SalesPerson } from "./SalesPersonModal";
import { MoreActionsModal } from "./MoreActionsModal";
import { PosHelpModal } from "./PosHelpModal";
import { LineDiscountModal } from "./LineDiscountModal";
import { DigitalReceiptQr } from "./DigitalReceiptQr";
import { WhatsAppReceiptButton } from "@/app/(app)/sales/[id]/WhatsAppReceiptButton";
import { ThermalPrinterModal } from "@/client/hardware/ThermalPrinterModal";
import { CameraBarcodeScannerModal } from "@/client/hardware/CameraBarcodeScannerModal";
import type { ReceiptData } from "@/client/hardware/escpos";
import { apiRequest } from "@/client/platform/apiClient";
import { classifyScan } from "@/client/pos/scanResult";
import type { ScannedItem } from "@/client/pos/types";
import { OfflineIndicatorPill } from "@/client/pos/OfflineIndicatorPill";
import { evaluatePromotions } from "@/server/promotions/promotionEngine";
import { useActivePromotions } from "@/server/promotions/promotionsStore";
import { playPosBeep } from "@/client/pos/posSound";

interface CatalogHit {
  variantId: string;
  productName: string;
  imageUrl: string | null;
  sku: string;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  priceMinor: number;
  mrpMinor?: number | null;
  taxRateBp: number;
  taxRateMode?: "FIXED" | "APPAREL_SLAB";
  taxTreatment: string;
  stockQuantity: number | null;
  reservedQuantity?: number | null;
  pendingPrices?: {
    id: string;
    priceMinor: number;
    mrpMinor: number | null;
    unitsAhead: number;
    oldStockRemaining?: number;
    newStockRemaining?: number;
  }[];
}

interface CartLine extends PricedLine {
  variantId: string;
  productName: string;
  imageUrl: string | null;
  sku: string;
  size: string | null;
  colour: string | null;
  stockQuantity: number | null;
  reservedQuantity?: number | null;
  originalUnitPriceMinor?: number;
  lineDiscountReason?: string;
  batchChoice?: "old" | "new";
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
  billNote?: string;
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
  billNote?: string;
  storeName: string;
  storeCode: string;
  storeAddressLine: string;
  storeCity: string;
  storeState: string;
  storePostalCode: string | null;
  storePhone?: string | null;
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

/** Stock as the reference's pill: in, low (1–10, the inventory screen's rule), out, or unknown, plus reserved hold indicator. */
function stockPill(quantity: number | null | undefined, reserved?: number | null): { text: string; className: string; dot: string; reservedPill?: string } {
  const reservedPill = (reserved ?? 0) > 0 ? `${reserved} reserved` : undefined;
  if (quantity == null) return { text: "Stock unknown", className: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400", reservedPill };
  if (quantity <= 0) return { text: "Out of Stock", className: "border-rose-200 bg-rose-50 text-rose-600", dot: "bg-rose-500", reservedPill };
  if (quantity <= 10) return { text: `Low Stock (${quantity})`, className: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500", reservedPill };
  return { text: `In Stock (${quantity})`, className: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", reservedPill };
}

/** How long an empty, loading grid waits before saying so and offering a retry. */
const SLOW_LOAD_MS = 6000;

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
  /** More matches exist past these; "Load more" fetches the next page. */
  hasMore?: boolean;
}

const EMPTY_SEARCH = { term: "", results: [], error: null, hasMore: false };

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

export function PosTerminal(props: {
  storeName: string;
  storeCode: string;
  cashierName: string;
  /** The store's garment GST slab, so the preview matches what the server will charge. */
  slab?: ApparelSlab | null;
  /** Owner or store manager: may discount more than the cashier limit. Defaults to the limit. */
  mayGiveLargeDiscount?: boolean;
  /** Owners and store managers here who have an approval PIN, for a cashier's larger discount. */
  approvers?: { id: string; name: string }[];
  /**
   * The business has a GSTIN. When it hasn't, it isn't GST-registered and sells NON_GST items at 0%
   * (owner 2026-10-15) — the same rule the server applies; the server stays the authority.
   */
  gstRegistered: boolean;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState<CatalogHit>>(EMPTY_SEARCH);
  const [activePromotions] = useActivePromotions();
  
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
  
  // Bill discount (owner rules 2026-10-13): typed as rupees or a percentage, always with a reason.
  const [discountKind, setDiscountKind] = useState<"amount" | "percent">("amount");
  const [discountRaw, setDiscountRaw] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<{
    kind: "amount" | "percent";
    value: number;
    reason: string;
    approval: { approverUserId: string; pin: string } | null;
  } | null>(null);
  const [approverId, setApproverId] = useState("");
  const [approverPin, setApproverPin] = useState("");
  // Udhar for a customer whose phone isn't verified: an owner/manager approves with their PIN.
  const [udharApproval, setUdharApproval] = useState<{ needed: boolean; approverId: string; pin: string }>({
    needed: false,
    approverId: "",
    pin: "",
  });
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [retrieveModalOpen, setRetrieveModalOpen] = useState(false);
  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [salesPersonModalOpen, setSalesPersonModalOpen] = useState(false);
  const [moreActionsModalOpen, setMoreActionsModalOpen] = useState(false);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [lineDiscountLine, setLineDiscountLine] = useState<CartLine | null>(null);
  const [salesPerson, setSalesPerson] = useState<SalesPerson | null>(null);
  const [saleError, setSaleError] = useState<string | null>(null);
  // Checkout refused because an item's price changed while the bill was open.
  const [priceChange, setPriceChange] = useState<{
    variantId: string;
    productName: string;
    sentPriceMinor: number;
    currentPriceMinor: number;
  } | null>(null);
  const [completed, setCompleted] = useState<CompletedSale | null>(null);
  const [lastCompletedReceipt, setLastCompletedReceipt] = useState<SaleReceipt | null>(null);
  // Customer loyalty points state
  const [customerLoyalty, setCustomerLoyalty] = useState<{
    availablePoints: number;
    pendingPoints: number;
    pointValueMinor: number;
    minRedeemPoints: number;
    programEnabled: boolean;
  } | null>(null);
  const [redeemedPoints, setRedeemedPoints] = useState<number>(0);
  const [billNote, setBillNote] = useState<string>("");
  const [billNoteOpen, setBillNoteOpen] = useState(false);
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

  const [entryMode, setEntryMode] = useState<"products" | "barcode" | "quick_add">("products");
  const [topSelling, setTopSelling] = useState<CatalogHit[]>([]);
  const [barcodeInputVal, setBarcodeInputVal] = useState("");
  const [barcodeScanNotice, setBarcodeScanNotice] = useState<string | null>(null);
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false);

  // Multi-MRP Price Selection Modal state (Collision resolver)
  const [pendingMrpItem, setPendingMrpItem] = useState<{
    hit: CatalogHit;
    pendingPrices: {
      id: string;
      priceMinor: number;
      mrpMinor: number | null;
      unitsAhead: number;
      oldStockRemaining?: number;
      newStockRemaining?: number;
    }[];
  } | null>(null);
  const [selectedBatchIndex, setSelectedBatchIndex] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/catalog/top-selling")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.items) {
          setTopSelling(d.items);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [catalogVersion]);

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
            ? { term: key, results: data.results as CatalogHit[], error: null, hasMore: Boolean(data.hasMore) }
            : { term: key, results: [], error: data?.error?.message ?? "Product lookup failed.", hasMore: false },
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

  // Load customer loyalty balance whenever active customer changes
  useEffect(() => {
    if (!customer?.id) {
      const resetTimer = setTimeout(() => {
        setCustomerLoyalty(null);
        setRedeemedPoints(0);
      }, 0);
      return () => clearTimeout(resetTimer);
    }
    let alive = true;
    fetch(`/api/v1/customers/${customer.id}/loyalty`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) {
          setCustomerLoyalty({
            availablePoints: d.availablePoints ?? 0,
            pendingPoints: d.pendingPoints ?? 0,
            pointValueMinor: d.pointValueMinor ?? 100,
            minRedeemPoints: d.minRedeemPoints ?? 100,
            programEnabled: Boolean(d.programEnabled),
          });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [customer?.id]);

  const settled = search.term === searchKey;
  const results = search.results;

  // "Load more": the next page for the same query and filters, appended. A change of search or
  // filter while it loads wins (the key check drops the stale page).
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = async () => {
    const key = search.term;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/v1/catalog/search?q=${encodeURIComponent(term)}${filterParams ? `&${filterParams}` : ""}&offset=${results.length}`,
      );
      const data = await res.json();
      if (!res.ok) return;
      setSearch((cur) =>
        cur.term !== key
          ? cur
          : { ...cur, results: [...cur.results, ...(data.results as CatalogHit[])], hasMore: Boolean(data.hasMore) },
      );
    } catch {
      // The button stays; the cashier can press it again.
    } finally {
      setLoadingMore(false);
    }
  };
  const searchError = settled ? search.error : null;
  const searching = !settled;

  // A slow first load showed only grey placeholders and "0 items". After a few seconds of an
  // empty, loading grid, say so and offer a retry that re-runs the catalogue requests.
  const [slowLoad, setSlowLoad] = useState(false);
  useEffect(() => {
    if (!(searching && results.length === 0)) {
      setSlowLoad(false);
      return;
    }
    const timer = setTimeout(() => setSlowLoad(true), SLOW_LOAD_MS);
    return () => clearTimeout(timer);
  }, [searching, results.length]);

  const addToCart = useCallback((hit: CatalogHit, overridePriceMinor?: number, batchChoice?: "old" | "new") => {
    setCartNotice(null);
    setSaleError(null);
    if (hit.taxTreatment === "UNSPECIFIED") {
      setCartNotice(`${hit.productName} cannot be sold until its tax treatment is classified in the catalogue.`);
      return;
    }
    const finalPriceMinor = overridePriceMinor ?? hit.priceMinor;
    // Exempt, nil-rated, zero-rated and non-GST lines sell at zero tax (owner B3, 2026-10-16).
    setCart((current) => {
      const existing = current.find((l) => l.variantId === hit.variantId && l.unitPriceMinor === finalPriceMinor);
      if (existing) {
        if (existing.quantity >= MAX_LINE_QUANTITY) {
          setCartNotice(`A line cannot exceed ${MAX_LINE_QUANTITY} units.`);
          return current;
        }
        return current.map((l) =>
          l.variantId === hit.variantId && l.unitPriceMinor === finalPriceMinor
            ? { ...l, quantity: l.quantity + 1 }
            : l,
        );
      }
      if (current.length >= MAX_LINES_PER_SALE) {
        setCartNotice(`A sale cannot have more than ${MAX_LINES_PER_SALE} lines.`);
        return current;
      }
      playPosBeep("scan");
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
          unitPriceMinor: finalPriceMinor,
          taxRateBp: hit.taxRateBp,
          taxRateMode: hit.taxRateMode,
          batchChoice,
        },
      ];
    });
    setQuery("");
    searchInput.current?.focus();
  }, []);

  const handleScanOrSelect = useCallback((hit: CatalogHit) => {
    // If item has pending price collision options where BOTH old and new stock > 0, show selection pop-up
    if (hit.pendingPrices && hit.pendingPrices.length > 0) {
      setSelectedBatchIndex(0);
      setPendingMrpItem({ hit, pendingPrices: hit.pendingPrices });
      return;
    }
    addToCart(hit);
  }, [addToCart]);

  /*
    Enter in the search box is a scan: a USB scanner types the barcode and presses Enter. The
    exact-barcode endpoint answers, never the fuzzy search, so a scan cannot land on a lookalike.
    A found item goes through addToCart (tax-treatment and line limits apply); a withdrawn or
    unknown code, or a failed lookup, leaves the cart alone. An unknown code keeps the typed text,
    so an ordinary name search typed into the same box still shows its results.
  */
  const scanBarcodeValue = useCallback(async (barcodeStr: string) => {
    const barcode = barcodeStr.trim();
    if (!barcode) return;
    try {
      const result = await apiRequest<{ item: ScannedItem & { taxTreatment?: string; imageUrl?: string | null } }>(
        `/api/v1/pos/scan?barcode=${encodeURIComponent(barcode)}`,
      );
      const outcome = classifyScan(barcode, result);
      if (outcome.kind === "found") {
        const item = outcome.item as ScannedItem & { taxTreatment?: string; imageUrl?: string | null };
        handleScanOrSelect({
          variantId: item.variantId,
          productName: item.productName,
          imageUrl: item.imageUrl ?? null,
          sku: item.sku,
          barcode: item.barcode,
          size: item.size,
          colour: item.colour,
          priceMinor: item.priceMinor,
          mrpMinor: item.mrpMinor,
          taxRateBp: item.taxRateBp,
          taxRateMode: item.taxRateMode,
          taxTreatment: item.taxTreatment ?? "UNSPECIFIED",
          stockQuantity: item.stockQuantity,
          pendingPrices: item.pendingPrices,
        });
        playPosBeep("scan");
        setBarcodeScanNotice(`Added: ${item.productName}`);
      } else if (outcome.kind === "not_for_sale") {
        setCartNotice(`${outcome.item.productName} (${outcome.item.sku}) has been withdrawn from sale.`);
      } else if (outcome.kind === "not_found") {
        setCartNotice(`Barcode not found: nothing in this catalogue matches ${outcome.barcode}.`);
      } else {
        setCartNotice(`${outcome.error.title}. ${outcome.error.detail}`.trim());
      }
    } catch {
      setCartNotice("Scan lookup error. Check network.");
    }
  }, [handleScanOrSelect]);

  const scanBusy = useRef(false);
  const scanFromSearch = useCallback(async () => {
    const barcode = query.trim();
    if (barcode.length === 0 || scanBusy.current) return;
    scanBusy.current = true;
    try {
      await scanBarcodeValue(barcode);
    } finally {
      scanBusy.current = false;
      searchInput.current?.focus();
    }
  }, [query, scanBarcodeValue]);

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

  const grossMinor = cart.reduce((sum, l) => sum + l.unitPriceMinor * l.quantity, 0);
  
  // Track 2: Automated Multi-Buy / BOGO / Tiered Spend Scheme Evaluation
  // Single-offer mode: only 1 offer applies per bill (Cashier / Owner choice, no stacking)
  const promoEvaluation = evaluatePromotions(
    cart.map((c) => ({
      variantId: c.variantId,
      quantity: c.quantity,
      unitPriceMinor: c.unitPriceMinor,
    })),
    activePromotions,
    {
      selectedOfferId,
      allowStacking: false,
    }
  );

  const manualDiscountMinor = appliedDiscount
    ? Math.min(
        grossMinor,
        appliedDiscount.kind === "percent"
          ? Math.round((grossMinor * appliedDiscount.value) / 100)
          : Math.round(appliedDiscount.value * 100),
      )
    : 0;

  // Loyalty points redemption: points * pointValueMinor
  const loyaltyDiscountMinor = customerLoyalty && redeemedPoints > 0
    ? Math.min(grossMinor - manualDiscountMinor, redeemedPoints * customerLoyalty.pointValueMinor)
    : 0;

  const totalDiscountMinor = Math.min(
    grossMinor,
    manualDiscountMinor + promoEvaluation.totalPromoDiscountMinor + loyaltyDiscountMinor
  );
  const totals = computeSaleTotals(cart, totalDiscountMinor, props.slab ?? null, props.gstRegistered);

  // Live: does what is typed (not yet applied) go over the cashier's 10%? Shows the approval row.
  const typedDiscountValue = Number(discountRaw);
  const typedDiscountMinor =
    discountRaw.trim() && Number.isFinite(typedDiscountValue) && typedDiscountValue > 0
      ? discountKind === "percent"
        ? Math.round((grossMinor * typedDiscountValue) / 100)
        : Math.round(typedDiscountValue * 100)
      : 0;
  const overCashierLimit = grossMinor > 0 && typedDiscountMinor * 10_000 > grossMinor * 1_000;

  function applyDiscount() {
    const value = Number(discountRaw);
    if (!discountRaw.trim() || !Number.isFinite(value) || value <= 0) {
      setDiscountError("Enter a discount above zero.");
      return;
    }
    if (discountKind === "percent" && value > 100) {
      setDiscountError("A percentage cannot be more than 100.");
      return;
    }
    if (discountReason.trim().length < 3) {
      setDiscountError("Give a reason for the discount.");
      return;
    }
    const minor = discountKind === "percent" ? Math.round((grossMinor * value) / 100) : Math.round(value * 100);
    if (minor > grossMinor) {
      setDiscountError("The discount cannot be more than the bill.");
      return;
    }
    let approval: { approverUserId: string; pin: string } | null = null;
    if (!props.mayGiveLargeDiscount && minor * 10_000 > grossMinor * 1_000) {
      if ((props.approvers ?? []).length === 0) {
        setDiscountError("Above 10% needs a manager's PIN, and no manager has set one yet (Settings → Your approval PIN).");
        return;
      }
      if (!approverId || !/^\d{4,6}$/.test(approverPin)) {
        setDiscountError("Above 10% needs approval: choose a manager and enter their PIN.");
        return;
      }
      approval = { approverUserId: approverId, pin: approverPin };
    }
    setDiscountError(null);
    setAppliedDiscount({ kind: discountKind, value, reason: discountReason.trim(), approval });
  }

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
    a valid amount paid now and something actually left on khata. Credit eligibility (verified
    phone, enabled account, limit, overdue bills, hold) is decided by the server against the
    customer's Company credit account, and its refusal is shown as-is (owner decisions Q5-Q10).
  */
  const udharPaidValid = /^\d{0,8}(\.\d{0,2})?$/.test(udharPaidRaw.trim());
  const udharPaidMinor = udharPaidValid && udharPaidRaw.trim() !== "" ? Math.round(Number.parseFloat(udharPaidRaw) * 100) : 0;
  const udharOnKhataMinor = Math.max(0, totals.totalMinor - udharPaidMinor);
  const customerDueMinor = customer?.dueMinor ?? 0;
  const udharNewDueMinor = customerDueMinor + udharOnKhataMinor;
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
              : null;
  const udharBlocked = method === "UDHAR" && cart.length > 0 && udharProblem !== null;

  function clearDiscount() {
    setAppliedDiscount(null);
    setDiscountRaw("");
    setDiscountReason("");
    setDiscountError(null);
    setApproverId("");
    setApproverPin("");
  }

  function startNewSale() {
    clearDiscount();
    setCart([]);
    setCustomer(null);
    setSalesPerson(null);
    setPicker({ open: false, mode: "search" });
    setUdharPaidRaw("");
    setUdharPayMethod("CASH");
    setMethod("CASH");
    setReference("");
    setAmountReceived(null);
    setBillNote("");
    setBillNoteOpen(false);
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
  async function loadReceipt(saleId: string, note?: string) {
    try {
      const res = await fetch(`/api/v1/sales/${saleId}`);
      if (!res.ok) {
        setReceiptFailed(true);
        return;
      }
      const data = await res.json();
      const loaded = data.sale as SaleReceipt;
      if (note) loaded.billNote = note;
      setReceipt(loaded);
      setLastCompletedReceipt(loaded);
    } catch {
      setReceiptFailed(true);
    }
  }

  function handleReprintLastBill() {
    if (!lastCompletedReceipt) {
      window.print();
      return;
    }
    // Re-open success dialog with last completed sale to reprint slip
    setCompleted({
      id: lastCompletedReceipt.id,
      billNumber: lastCompletedReceipt.billNumber,
      totalMinor: lastCompletedReceipt.totalMinor,
      paidMinor: lastCompletedReceipt.paidMinor,
      dueMinor: Math.max(0, lastCompletedReceipt.totalMinor - lastCompletedReceipt.paidMinor),
      erpSyncStatus: lastCompletedReceipt.erpSyncStatus,
      duplicate: false,
    });
    setReceipt(lastCompletedReceipt);
    setReceiptFailed(false);
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
    setPriceChange(null);

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
          lines: cart.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            unitPriceMinor: l.unitPriceMinor,
            batchChoice: l.batchChoice,
          })),
          customerId: customer?.id ?? null,
          ...(totals.discountMinor > 0
            ? {
                discountMinor: totals.discountMinor,
                discountReason:
                  appliedDiscount?.reason ||
                  promoEvaluation.promotionsApplied[0]?.ruleName ||
                  "Promotional Offer",
                ...(appliedDiscount?.approval ? { discountApproval: appliedDiscount.approval } : {}),
              }
            : {}),
          ...(method === "UDHAR"
            ? {
                onAccountMinor: udharOnKhataMinor,
                ...(udharApproval.needed && udharApproval.approverId && /^\d{4,6}$/.test(udharApproval.pin)
                  ? { creditApproval: { approverUserId: udharApproval.approverId, pin: udharApproval.pin } }
                  : {}),
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
        if (data?.error?.code === "price_mismatch" && typeof data.error.currentPriceMinor === "number") {
          const line = cart.find((l) => l.variantId === data.error.variantId);
          setPriceChange({
            variantId: data.error.variantId,
            productName: line?.productName ?? "an item",
            sentPriceMinor: data.error.sentPriceMinor,
            currentPriceMinor: data.error.currentPriceMinor,
          });
          return;
        }
        if (data?.error?.code === "discount_not_allowed") {
          // The discount itself was refused (wrong or locked PIN, over the limit): take it off the
          // bill and say why beside the discount controls, so the cashier can fix it and retry.
          const message = data.error.message ?? "That discount needs approval.";
          clearDiscount();
          setDiscountError(message);
          setSaleError(`${message} The discount has been removed — apply it again or complete without it.`);
          return;
        }
        if (data?.error?.code === "udhar_needs_approval") {
          // Not a dead end: ask for an owner/manager PIN right here and try the same bill again.
          setUdharApproval((u) => ({ ...u, needed: true, pin: "" }));
          setSaleError(data.error.message ?? "This udhar needs an owner or store manager's PIN.");
          return;
        }
        setSaleError(data?.error?.message ?? "Could not complete the sale.");
        return;
      }
      setUdharApproval({ needed: false, approverId: "", pin: "" });
      setCompleted({
        id: data.sale.id,
        billNumber: data.sale.billNumber,
        totalMinor: data.sale.totalMinor,
        paidMinor: data.sale.paidMinor,
        dueMinor: data.sale.dueMinor ?? Math.max(0, data.sale.totalMinor - data.sale.paidMinor),
        erpSyncStatus: data.sale.erpSyncStatus,
        duplicate: Boolean(data.duplicate),
        billNote: billNote.trim() || undefined,
      });
      playPosBeep("success");
      // The sale has decremented stock: re-read the grid so the counts are current now,
      // not on the next manual refresh.
      setCatalogVersion((v) => v + 1);
      // Not awaited: the success screen must appear the moment the sale is real. The
      // receipt fills in behind it.
      setReceipt(null);
      setReceiptFailed(false);
      void loadReceipt(data.sale.id, billNote.trim() || undefined);
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
      if (event.key !== "F6") return;
      event.preventDefault();
      setOfferModalOpen((o) => !o);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "F7") return;
      event.preventDefault();
      setSalesPersonModalOpen((o) => !o);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "F1") {
        event.preventDefault();
        setHelpModalOpen((o) => !o);
      } else if (event.key === "F9") {
        event.preventDefault();
        playPosBeep("drawer");
      }
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
          {/* Entry modes, as the reference's underlined tabs. Products, Barcode Scan, and Quick Add now active. */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
            {/* The tablist holds only the tabs; the offline pill sits beside it (axe: aria-required-children). */}
            <div role="tablist" aria-label="Product entry mode" className="flex items-end gap-4 sm:gap-8">
              <button
                type="button"
                role="tab"
                aria-selected={entryMode === "products"}
                onClick={() => setEntryMode("products")}
                className={`relative h-14 whitespace-nowrap text-[15px] font-semibold transition-colors sm:text-[17px] [@media(max-height:820px)]:h-12 ${
                  entryMode === "products"
                    ? "text-sky-700 after:absolute after:inset-x-0 after:bottom-0 after:h-[2.5px] after:rounded-full after:bg-primary"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Products
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={entryMode === "barcode"}
                onClick={() => setEntryMode("barcode")}
                className={`relative h-14 whitespace-nowrap text-[15px] font-semibold transition-colors sm:text-[17px] [@media(max-height:820px)]:h-12 ${
                  entryMode === "barcode"
                    ? "text-sky-700 after:absolute after:inset-x-0 after:bottom-0 after:h-[2.5px] after:rounded-full after:bg-primary"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Barcode Scan
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={entryMode === "quick_add"}
                onClick={() => setEntryMode("quick_add")}
                className={`relative h-14 whitespace-nowrap text-[15px] font-semibold transition-colors sm:text-[17px] flex items-center gap-1.5 [@media(max-height:820px)]:h-12 ${
                  entryMode === "quick_add"
                    ? "text-sky-700 after:absolute after:inset-x-0 after:bottom-0 after:h-[2.5px] after:rounded-full after:bg-primary"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Quick Add
                <span className="rounded-full bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-800">Top 10</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <OfflineIndicatorPill />
            </div>
          </div>

          {entryMode === "products" && (
            <>
              {/* Search, filters, categories */}
              <div className="shrink-0 space-y-3 bg-white px-5 pb-3 pt-3.5 [@media(max-height:820px)]:space-y-2 [@media(max-height:820px)]:pt-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex-1">
                    <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500" />
                    <input
                      ref={searchInput}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        void scanFromSearch();
                      }}
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
                        className="absolute right-2 top-1/2 flex min-h-11 min-w-11 lg:h-7 lg:w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setCameraScannerOpen(true)}
                    aria-label="Scan barcode using camera"
                    title="Scan barcode with device camera"
                    className="amb-press flex size-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:border-sky-300 hover:text-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                  >
                    <Camera aria-hidden="true" className="h-5 w-5 text-sky-600" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryMode("barcode")}
                    aria-label="Scan barcode into search"
                    title="Open dedicated barcode scanning hub"
                    className="amb-press flex size-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:border-sky-300 hover:text-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                  >
                    <ScanLine aria-hidden="true" className="h-5 w-5" />
                  </button>
                </div>

                {/* Filters */}
                <div role="group" aria-label="Product filters" className="no-scrollbar relative flex items-center gap-2 overflow-x-auto">
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

                {/* Category tiles */}
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
                        <span className="text-[10px] tabular-nums text-slate-600 [@media(max-height:820px)]:hidden">{cat.count} {cat.count === 1 ? "item" : "items"}</span>
                      </button>
                    );
                  })}
                  {!facets &&
                    [0, 1, 2, 3].map((n) => <div key={n} aria-hidden="true" className="amb-skeleton h-[74px] w-[84px] shrink-0 rounded-lg bg-slate-100 [@media(max-height:820px)]:h-10" />)}
                </div>
              </div>

              {/* Product grid */}
              <div tabIndex={0} role="region" aria-label="Product results" className="h-[60vh] min-h-[320px] overflow-y-auto overscroll-contain px-5 py-3 lg:h-auto lg:min-h-0 lg:flex-1">
                {searchError && (
                  <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">
                    {searchError}
                  </p>
                )}

                {slowLoad && (
                  <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
                    <span>Still loading the products. This is taking longer than usual.</span>
                    <button
                      type="button"
                      onClick={() => setCatalogVersion((v) => v + 1)}
                      className="amb-press min-h-11 rounded-lg border border-amber-300 bg-white px-3 font-semibold text-amber-900 hover:bg-amber-100"
                    >
                      Retry
                    </button>
                  </div>
                )}
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
                    <span aria-hidden="true" className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
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
                    const stock = stockPill(hit.stockQuantity, hit.reservedQuantity);
                    return (
                      <button
                        type="button"
                        key={hit.variantId}
                        onClick={() => handleScanOrSelect(hit)}
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
                            className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                          >
                            <Plus className="h-4 w-4" />
                          </span>
                        </div>
                        <div className="flex flex-1 flex-col px-1 pb-0.5 pt-2">
                          <p className="truncate text-[12px] font-medium text-slate-900">{hit.productName}</p>
                          <p className="mt-0.5 text-[14px] font-bold tabular-nums text-slate-900">{formatMinor(hit.priceMinor)}</p>
                          <p className="truncate text-[11px] text-slate-500">{hit.sku}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <span className={`inline-flex w-fit max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${stock.className}`}>
                              <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${stock.dot}`} />
                              <span className="truncate">{stock.text}</span>
                            </span>
                            {stock.reservedPill && (
                              <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700" title="Held for orders or online checkouts">
                                {stock.reservedPill}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {search.hasMore && search.term === searchKey && (
                  <div className="mt-4 flex flex-col items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void loadMore()}
                      disabled={loadingMore}
                      aria-busy={loadingMore}
                      className="amb-focus amb-press inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {loadingMore ? "Loading…" : "Load more products"}
                    </button>
                    <span className="text-[12px] text-slate-500">Showing {results.length}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {entryMode === "barcode" && (
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
              <div className="mx-auto max-w-xl rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm space-y-6 text-center">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2.5 text-left">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-4 ring-sky-50">
                      <ScanLine className="h-6 w-6" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-900">Barcode Quick Scan &amp; Entry</h2>
                      <p className="text-xs text-slate-500">
                        Scan with USB/Bluetooth barcode reader or use camera scanner
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCameraScannerOpen(true)}
                    className="amb-press flex items-center justify-center gap-2 rounded-xl border border-sky-300 bg-sky-50 px-3.5 py-2 text-xs font-bold text-sky-800 hover:bg-sky-100 shadow-sm"
                  >
                    <Camera className="h-4 w-4" />
                    <span>Open Camera</span>
                  </button>
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const code = barcodeInputVal.trim();
                    if (!code) return;
                    setBarcodeScanNotice(null);
                    try {
                      const res = await apiRequest<{ item: ScannedItem & { taxTreatment?: string; imageUrl?: string | null } }>(
                        `/api/v1/pos/scan?barcode=${encodeURIComponent(code)}`,
                      );
                      const outcome = classifyScan(code, res);
                      if (outcome.kind === "found") {
                        const item = outcome.item as ScannedItem & { taxTreatment?: string; imageUrl?: string | null };
                        handleScanOrSelect({
                          variantId: item.variantId,
                          productName: item.productName,
                          imageUrl: item.imageUrl ?? null,
                          sku: item.sku,
                          barcode: item.barcode,
                          size: item.size,
                          colour: item.colour,
                          priceMinor: item.priceMinor,
                          mrpMinor: item.mrpMinor,
                          taxRateBp: item.taxRateBp,
                          taxRateMode: item.taxRateMode,
                          taxTreatment: item.taxTreatment ?? "UNSPECIFIED",
                          stockQuantity: item.stockQuantity,
                          pendingPrices: item.pendingPrices,
                        });
                        setBarcodeScanNotice(`Added: ${item.productName}`);
                        setBarcodeInputVal("");
                      } else {
                        setBarcodeScanNotice("Barcode not found in catalog.");
                      }
                    } catch {
                      setBarcodeScanNotice("Scan lookup error. Check network.");
                    }
                  }}
                  className="space-y-4"
                >
                  <div className="relative">
                    <input
                      type="text"
                      autoFocus
                      value={barcodeInputVal}
                      onChange={(e) => setBarcodeInputVal(e.target.value)}
                      placeholder="Scan or type barcode (e.g. 890123...)"
                      className="h-13 w-full rounded-2xl border-2 border-sky-500/50 bg-white px-4 text-center font-mono text-lg font-bold text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-4 focus:ring-sky-500/15"
                    />
                  </div>

                  {barcodeScanNotice && (
                    <p className={`rounded-xl p-3 text-xs font-semibold ${barcodeScanNotice.startsWith("Added") ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-rose-50 text-rose-800 border border-rose-200"}`}>
                      {barcodeScanNotice}
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      className="amb-press flex-1 rounded-xl bg-primary py-3 text-sm font-bold text-white shadow-md hover:bg-primary-active"
                    >
                      Lookup &amp; Add Item (Enter)
                    </button>
                    {barcodeInputVal && (
                      <button
                        type="button"
                        onClick={() => setBarcodeInputVal("")}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </form>

                {/* Tactile Keypad */}
                <div className="grid grid-cols-3 gap-2 pt-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, "C", 0, "⌫"].map((btn) => (
                    <button
                      key={btn}
                      type="button"
                      onClick={() => {
                        if (btn === "C") setBarcodeInputVal("");
                        else if (btn === "⌫") setBarcodeInputVal((v) => v.slice(0, -1));
                        else setBarcodeInputVal((v) => v + btn);
                      }}
                      className="amb-press h-12 rounded-xl border border-slate-200 bg-slate-50 font-mono text-base font-bold text-slate-800 hover:bg-sky-50 hover:border-sky-300"
                    >
                      {btn}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {entryMode === "quick_add" && (
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
                <div className="flex items-center gap-2">
                  <Flame className="h-5 w-5 text-orange-500" />
                  <h2 className="text-base font-bold text-slate-900">Fast-Selling SKUs &amp; Quick Add</h2>
                </div>
                <span className="text-xs font-medium text-slate-500">Tap to add directly to cart</span>
              </div>

              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                {topSelling.map((hit, i) => {
                  const stock = stockPill(hit.stockQuantity, hit.reservedQuantity);
                  return (
                    <button
                      type="button"
                      key={hit.variantId}
                      onClick={() => addToCart(hit)}
                      className="amb-press group flex flex-col rounded-2xl border-2 border-slate-200 bg-white p-2.5 text-left shadow-sm hover:border-amber-400 hover:shadow-md transition-all"
                    >
                      <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-slate-50">
                        {hit.imageUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={hit.imageUrl} alt={hit.productName} className="h-full w-full object-cover" />
                        ) : (
                          <Package aria-hidden="true" className="h-8 w-8 text-slate-300" />
                        )}
                        <span className="absolute top-1.5 left-1.5 rounded-md bg-amber-500 px-1.5 py-0.5 text-[9px] font-black text-white shadow">
                          #{i + 1}
                        </span>
                        <span className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white shadow-md">
                          <Plus className="h-4 w-4" />
                        </span>
                      </div>
                      <div className="flex flex-1 flex-col pt-2">
                        <p className="truncate text-xs font-bold text-slate-900">{hit.productName}</p>
                        <p className="text-[13px] font-black text-slate-950 font-mono mt-0.5">{formatMinor(hit.priceMinor)}</p>
                        <p className="text-[11px] text-slate-400 truncate">{hit.sku}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-1.5 py-0.2 text-[9px] font-semibold ${stock.className}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${stock.dot}`} />
                            {stock.text}
                          </span>
                          {stock.reservedPill && (
                            <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.2 text-[8.5px] font-semibold text-violet-700">
                              {stock.reservedPill}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick actions — not built yet, labelled as such. */}
          <div className="shrink-0 px-5 pb-4 pt-1 [@media(max-height:820px)]:pb-2">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <h2 className="mb-2.5 text-[15px] font-bold text-slate-900 [@media(max-height:820px)]:sr-only">Quick Actions</h2>
              <div role="group" aria-label="Quick actions" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                <ActionBtn icon={<PauseCircle className="h-5 w-5" />} label="Hold Bill" hotkey="F3" onClick={handleHoldBill} disabled={cart.length === 0 || submitting} />
                <ActionBtn icon={<History className="h-5 w-5" />} label="Retrieve Bill" hotkey="F4" onClick={() => setRetrieveModalOpen(true)} disabled={submitting} />
                <ActionBtn icon={<UserPlus className="h-5 w-5" />} label="New Customer" hotkey="F5" onClick={() => openPicker(true, "new")} />
                <ActionBtn icon={<BadgePercent className="h-5 w-5" />} label="Apply Offer" hotkey="F6" onClick={() => setOfferModalOpen(true)} />
                <ActionBtn
                  icon={<UserCog className="h-5 w-5" />}
                  label={salesPerson ? salesPerson.name.split(" ")[0]! : "Sales Person"}
                  hotkey="F7"
                  onClick={() => setSalesPersonModalOpen(true)}
                />
                <ActionBtn
                  icon={<Ellipsis className="h-5 w-5" />}
                  label="More Actions"
                  onClick={() => setMoreActionsModalOpen(true)}
                />
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
            <h2 className="relative flex h-11 items-center text-[15px] font-semibold text-sky-700 after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:rounded-full after:bg-primary">
              Cart ({itemCount})<span className="sr-only"> items in cart</span>
            </h2>
            <button
              type="button"
              onClick={() => openPicker(true, "search")}
              aria-expanded={picker.open}
              aria-controls="pos-customer-area"
              className={`relative h-11 cursor-pointer text-[15px] font-medium transition-colors hover:text-slate-800 ${picker.open ? "text-sky-700 after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:rounded-full after:bg-primary" : "text-slate-500"}`}
            >
              Customer
              {(customer?.dueMinor ?? 0) > 0 && (
                <span aria-hidden="true" className="absolute -right-2.5 top-2.5 h-2 w-2 rounded-full bg-amber-500" />
              )}
            </button>
            {salesPerson && (
              <button
                type="button"
                onClick={() => setSalesPersonModalOpen(true)}
                title={`Attributed Sales Staff: ${salesPerson.name} (${salesPerson.role})`}
                className="ml-auto mb-2.5 flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-800 hover:bg-sky-100 transition-colors"
              >
                <UserCog className="h-3 w-3 text-sky-600" />
                <span className="max-w-[90px] truncate">{salesPerson.name.split(" ")[0]}</span>
              </button>
            )}
          </div>

          <div ref={customerArea} id="pos-customer-area" className="shrink-0 border-b border-slate-100 px-3 py-2">
            <CustomerPicker
              customer={customer}
              onChange={setCustomer}
              open={picker.open}
              mode={picker.mode}
              onOpenChange={openPicker}
            />

            {/* Customer Loyalty Points Badge & Live Redemption */}
            {customer && customerLoyalty && (
              <div className="mt-2 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    <Award className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <span className="font-bold text-amber-900">{customerLoyalty.availablePoints} pts</span>
                    <span className="text-[10px] text-amber-700 block">
                      ≈ ₹{Math.round((customerLoyalty.availablePoints * customerLoyalty.pointValueMinor) / 100)} value
                    </span>
                  </div>
                </div>

                {redeemedPoints > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-emerald-800 text-[11px]">
                      −{formatMinor(loyaltyDiscountMinor)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRedeemedPoints(0)}
                      className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-rose-600 border border-slate-200 hover:bg-rose-50"
                    >
                      Remove
                    </button>
                  </div>
                ) : customerLoyalty.availablePoints >= customerLoyalty.minRedeemPoints ? (
                  <button
                    type="button"
                    onClick={() => {
                      // Redeem maximum available points up to gross bill total
                      const maxPointsByBill = Math.floor(grossMinor / customerLoyalty.pointValueMinor);
                      const pointsToRedeem = Math.min(customerLoyalty.availablePoints, maxPointsByBill);
                      setRedeemedPoints(pointsToRedeem);
                    }}
                    className="amb-press rounded-md bg-amber-600 px-2 py-1 text-[11px] font-bold text-white shadow-xs hover:bg-amber-700 transition-colors"
                  >
                    Redeem Points
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-400">
                    Min {customerLoyalty.minRedeemPoints} pts
                  </span>
                )}
              </div>
            )}
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
                  <div
                    onClick={() => setLineDiscountLine(line)}
                    className="cursor-pointer select-none group-hover:opacity-95"
                    title="Click to apply item discount"
                  >
                    <p className="min-w-0 truncate text-[12px] font-semibold leading-tight text-slate-900 group-hover:text-sky-700 transition-colors">
                      {line.productName}
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <p className="text-[12.5px] font-semibold tabular-nums text-slate-900">
                      {formatMinor(line.unitPriceMinor * line.quantity)}
                    </p>
                    <button
                      type="button"
                      onClick={() => setLineDiscountLine(line)}
                      title="Item discount (% or ₹ off)"
                      aria-label={`Apply discount on ${line.productName}`}
                      className="amb-focus flex min-h-11 min-w-11 lg:h-6 lg:w-6 lg:min-h-0 lg:min-w-0 cursor-pointer items-center justify-center rounded-md text-sky-600 transition-colors hover:bg-sky-50 hover:text-sky-700"
                    >
                      <Tag className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuantity(line.variantId, 0)}
                      aria-label={`Remove ${line.productName} from cart`}
                      className="amb-focus flex min-h-11 min-w-11 lg:h-6 lg:w-6 lg:min-h-0 lg:min-w-0 cursor-pointer items-center justify-center rounded-md text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div
                    onClick={() => setLineDiscountLine(line)}
                    className="cursor-pointer select-none min-w-0"
                    title="Click to apply item discount"
                  >
                    <p className="min-w-0 truncate text-[11px] leading-tight text-slate-500">
                      <span className="font-semibold tabular-nums text-slate-700">{formatMinor(line.unitPriceMinor)}</span>
                      {line.originalUnitPriceMinor && line.originalUnitPriceMinor !== line.unitPriceMinor && (
                        <span className="ml-1 line-through text-[10px] text-slate-400 font-mono">
                          {formatMinor(line.originalUnitPriceMinor)}
                        </span>
                      )}
                      {" · "}
                      {line.sku}
                      {variantLabel(line) ? ` | ${variantLabel(line)}` : ""}
                      {line.originalUnitPriceMinor && line.originalUnitPriceMinor !== line.unitPriceMinor && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1 py-0.2 text-[9px] font-bold text-emerald-800 border border-emerald-200">
                          {line.lineDiscountReason ? `${line.lineDiscountReason}` : "Discounted"}
                        </span>
                      )}
                      {line.stockQuantity !== null && line.stockQuantity <= 3 && (
                        <span className={`ml-1.5 inline-flex items-center gap-0.5 rounded px-1 py-0.2 text-[9.5px] font-bold ${
                          line.stockQuantity <= 0 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"
                        }`}>
                          {line.stockQuantity <= 0 ? "Out of Stock" : `Low: ${line.stockQuantity} left`}
                        </span>
                      )}
                      {(line.reservedQuantity ?? 0) > 0 && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded border border-violet-200 bg-violet-50 px-1 py-0.2 text-[9px] font-bold text-violet-700">
                          {line.reservedQuantity} reserved
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex min-h-11 lg:h-6 shrink-0 items-center justify-self-end overflow-hidden rounded-md border border-slate-200 bg-white text-slate-700">
                    <button
                      type="button"
                      onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                      aria-label={`Decrease quantity of ${line.productName}`}
                      className="amb-focus flex min-h-11 min-w-11 lg:h-full lg:w-6 lg:min-h-0 lg:min-w-0 cursor-pointer items-center justify-center text-sky-700 transition-colors hover:bg-slate-100 active:bg-slate-200"
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
                      className="amb-focus flex min-h-11 min-w-11 lg:h-full lg:w-6 lg:min-h-0 lg:min-w-0 cursor-pointer items-center justify-center text-sky-700 transition-colors hover:bg-slate-100 active:bg-slate-200"
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
            {/* Bill discount: amount or percent, always with a reason (owner rules 2026-10-13). */}
            {appliedDiscount ? (
              <div className="amb-fade-in mb-2 flex items-center justify-between rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11.5px] text-emerald-900 border border-emerald-200">
                <span className="min-w-0 flex-1 truncate font-medium">
                  Discount: {appliedDiscount.kind === "percent" ? `${appliedDiscount.value}%` : formatMinor(Math.round(appliedDiscount.value * 100))}
                  <span className="text-emerald-700 ml-1.5 font-normal text-[10.5px]">({appliedDiscount.reason})</span>
                </span>
                <button
                  type="button"
                  onClick={clearDiscount}
                  className="amb-focus ml-2 text-[11px] font-semibold text-rose-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            ) : discountOpen ? (
              <fieldset className="mb-2 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/50 p-2" disabled={cart.length === 0}>
                <div className="flex items-center justify-between pb-1 border-b border-slate-200/60">
                  <span className="text-[11px] font-bold text-slate-700">Add Bill Discount</span>
                  <button
                    type="button"
                    onClick={() => setDiscountOpen(false)}
                    className="text-[11px] font-medium text-slate-400 hover:text-slate-600"
                  >
                    Cancel
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    value={discountRaw}
                    onChange={(e) => setDiscountRaw(e.target.value)}
                    inputMode="decimal"
                    placeholder={discountKind === "percent" ? "Discount %" : "Discount ₹"}
                    aria-label={discountKind === "percent" ? "Discount percent" : "Discount amount in rupees"}
                    className="amb-focus min-h-11 lg:h-8 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-[12px] tabular-nums placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-50"
                  />
                  <button
                    type="button"
                    aria-pressed={discountKind === "percent"}
                    aria-label="Discount as a percentage"
                    onClick={() => setDiscountKind("percent")}
                    className={`amb-focus min-h-11 min-w-11 lg:h-8 lg:w-8 rounded-lg border text-[11.5px] font-semibold transition-colors ${discountKind === "percent" ? "border-sky-600 bg-sky-50 text-sky-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    aria-pressed={discountKind === "amount"}
                    aria-label="Discount as an amount"
                    onClick={() => setDiscountKind("amount")}
                    className={`amb-focus min-h-11 min-w-11 lg:h-8 lg:w-8 rounded-lg border text-[11.5px] font-semibold transition-colors ${discountKind === "amount" ? "border-sky-600 bg-sky-50 text-sky-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
                  >
                    ₹
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)}
                    maxLength={200}
                    placeholder="Reason (required)"
                    aria-label="Discount reason"
                    className="amb-focus min-h-11 lg:h-8 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-[12px] placeholder:text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-50"
                  />
                  <button
                    type="button"
                    onClick={applyDiscount}
                    className="amb-focus amb-press min-h-11 lg:h-8 rounded-lg border border-slate-300 px-3 text-[11.5px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 bg-white"
                  >
                    Apply
                  </button>
                </div>
                {!props.mayGiveLargeDiscount && overCashierLimit && (props.approvers ?? []).length > 0 && (
                  <div className="amb-fade-in flex items-center gap-1.5 rounded-lg bg-amber-50 p-1.5">
                    <select
                      value={approverId}
                      onChange={(e) => setApproverId(e.target.value)}
                      aria-label="Manager approving this discount"
                      className="amb-focus min-h-11 lg:h-8 min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-2 text-[11.5px] text-slate-800"
                    >
                      <option value="">Approved by…</option>
                      {(props.approvers ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={6}
                      value={approverPin}
                      onChange={(e) => setApproverPin(e.target.value.replace(/\D/g, ""))}
                      placeholder="PIN"
                      aria-label="Manager's approval PIN"
                      className="amb-focus h-8 w-16 rounded-lg border border-amber-300 bg-white px-2 text-center text-[11.5px] tracking-widest placeholder:text-slate-500"
                    />
                  </div>
                )}
                {discountError && (
                  <p role="alert" className="amb-pop-in text-[10.5px] text-rose-700">
                    {discountError}
                  </p>
                )}
                {!props.mayGiveLargeDiscount && !overCashierLimit && (
                  <p className="text-[10px] text-slate-500">Up to 10% of bill. More needs manager PIN.</p>
                )}
              </fieldset>
            ) : null}

            <dl className="space-y-0.5 text-[12px]">
              <div className="flex items-center justify-between text-slate-600">
                <dt>Items ({itemCount})</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{formatMinor(totals.grossMinor)}</dd>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <dt className="flex items-center gap-1.5">
                  <span>Discount</span>
                  {!appliedDiscount && !discountOpen && cart.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setDiscountOpen(true)}
                      className="text-[10.5px] font-semibold text-sky-700 hover:text-sky-800 hover:underline"
                    >
                      + Add
                    </button>
                  )}
                </dt>
                <dd className={totals.discountMinor > 0 ? "font-medium tabular-nums text-emerald-700" : "text-slate-400"}>
                  {totals.discountMinor > 0 ? `−${formatMinor(totals.discountMinor)}` : "—"}
                </dd>
              </div>
              {promoEvaluation.promotionsApplied.length > 0 && (
                <div className="space-y-1 py-1">
                  {promoEvaluation.promotionsApplied.map((p) => (
                    <div key={p.ruleId} className="flex items-center justify-between rounded bg-purple-50 px-2 py-0.5 text-[11px] text-purple-900 border border-purple-200/60">
                      <span className="font-semibold flex items-center gap-1">
                        <Tag className="h-2.5 w-2.5 text-purple-600" /> {p.ruleName}
                      </span>
                      <span className="font-mono font-bold text-emerald-700">−{formatMinor(p.discountMinor)}</span>
                    </div>
                  ))}
                </div>
              )}
              {totals.discountMinor > 0 && (
                <div className="flex items-center justify-between text-slate-600">
                  <dt>Taxable value</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">{formatMinor(totals.subtotalMinor)}</dd>
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
                    className={`amb-focus flex min-h-11 lg:h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border px-1 text-[11.5px] font-medium transition-colors ${selected ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"}`}
                    onClick={() => {
                      setMethod(m.value);
                      if (m.value !== "SPLIT") setAmountReceived(null);
                      if (m.value === "UDHAR" && !customer) openPicker(true, "search");
                    }}
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
                    <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">
                      ₹
                    </span>
                    <input
                      id="amount-received"
                      className="min-h-11 lg:h-8 w-32 rounded-lg border border-slate-200 bg-white pl-7 pr-2.5 text-right text-[14px] font-bold tabular-nums text-slate-900 outline-none transition-colors placeholder:font-normal placeholder:text-slate-500 focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15"
                      type="number"
                      value={amountReceived ?? ""}
                      onChange={(e) => setAmountReceived(e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder="0.00"
                      inputMode="decimal"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {tenderSuggestions(totals.totalMinor).map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setAmountReceived(amount)}
                      className="amb-press amb-focus min-h-11 cursor-pointer rounded-md border border-sky-200 bg-white text-[11.5px] font-semibold tabular-nums text-sky-700 transition-colors hover:bg-sky-50"
                    >
                      ₹{amount.toLocaleString("en-IN")}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAmountReceived(totals.totalMinor / 100)}
                    className="amb-press amb-focus min-h-11 cursor-pointer rounded-md border border-slate-200 bg-white text-[11.5px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Exact
                  </button>
                </div>
                {/* Short while under the total, change when over, settled when exact. Words carry the meaning, not colour. */}
                {(() => {
                  const tenderedMinor = amountReceived == null ? null : Math.round(amountReceived * 100);
                  const deltaMinor = tenderedMinor == null ? null : tenderedMinor - totals.totalMinor;
                  const label = deltaMinor == null ? "Balance" : deltaMinor > 0 ? "Change due" : deltaMinor < 0 ? "Short by" : "Balance";
                  const tone = deltaMinor == null ? "text-slate-500" : deltaMinor > 0 ? "text-emerald-600" : deltaMinor < 0 ? "text-rose-600" : "text-emerald-600";
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
              <div className="no-scrollbar mt-3 flex max-h-[220px] flex-col gap-2 overflow-y-auto">
                {/* Quick Split Presets */}
                <div className="flex items-center gap-1.5 pb-1 border-b border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      const totalRs = totals.totalMinor / 100;
                      const half1 = Math.round((totalRs / 2) * 100) / 100;
                      const half2 = Math.round((totalRs - half1) * 100) / 100;
                      setSplitPayments([
                        { id: "1", method: "CASH", amount: half1, reference: "" },
                        { id: "2", method: "UPI", amount: half2, reference: "" },
                      ]);
                    }}
                    className="flex-1 rounded-md border border-slate-200 bg-slate-50 py-1 text-[10px] font-bold text-slate-700 hover:border-sky-300 hover:bg-sky-50 transition-colors"
                  >
                    50 / 50 Cash+UPI
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const totalRs = totals.totalMinor / 100;
                      const roundCash = Math.floor(totalRs / 100) * 100;
                      const restUpi = Math.round((totalRs - roundCash) * 100) / 100;
                      if (roundCash > 0 && restUpi > 0) {
                        setSplitPayments([
                          { id: "1", method: "CASH", amount: roundCash, reference: "" },
                          { id: "2", method: "UPI", amount: restUpi, reference: "" },
                        ]);
                      }
                    }}
                    className="flex-1 rounded-md border border-slate-200 bg-slate-50 py-1 text-[10px] font-bold text-slate-700 hover:border-sky-300 hover:bg-sky-50 transition-colors"
                  >
                    Round Cash + UPI
                  </button>
                  {splitRemainingMinor > 0 && splitPayments.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const remRs = splitRemainingMinor / 100;
                        setSplitPayments((curr) => {
                          const lastIdx = curr.length - 1;
                          return curr.map((row, idx) =>
                            idx === lastIdx
                              ? { ...row, amount: Math.round(((row.amount ?? 0) + remRs) * 100) / 100 }
                              : row
                          );
                        });
                      }}
                      className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-100 transition-colors"
                    >
                      Fill Remainder
                    </button>
                  )}
                </div>
                {splitPayments.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5">
                    {/* Labelled by row number: position is what distinguishes one payment from another. */}
                    <select
                      aria-label={`Payment ${i + 1} method`}
                      value={p.method}
                      onChange={(e) => setSplitPayments((curr) => curr.map((x) => (x.id === p.id ? { ...x, method: e.target.value as SplitMethod } : x)))}
                      className="min-h-11 lg:h-8 w-20 cursor-pointer rounded-lg border-none bg-slate-100 px-1.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
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
                        className="min-h-11 lg:h-8 w-16 flex-1 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
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
                      className="min-h-11 lg:h-8 w-[78px] rounded-lg border border-slate-200 px-2 text-right text-xs font-bold tabular-nums outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
                    />
                    <button
                      type="button"
                      aria-label={`Remove payment ${i + 1}`}
                      onClick={() => setSplitPayments((curr) => curr.filter((x) => x.id !== p.id))}
                      className="amb-focus flex min-h-11 min-w-11 lg:h-8 lg:w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
                    >
                      <X aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setSplitPayments((curr) => [...curr, { id: Date.now().toString(), method: "CASH", amount: null, reference: "" }])}
                  className="min-h-11 lg:h-9 w-full shrink-0 rounded-xl border border-dashed border-blue-300 bg-blue-50/70 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100"
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
                      aria-label="Add customer for udhar"
                      className="amb-press min-h-11 lg:h-7 shrink-0 cursor-pointer rounded-md bg-white px-2.5 text-[11.5px] font-semibold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100"
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
                          className="min-h-11 lg:h-8 cursor-pointer rounded-lg border border-slate-200 bg-white px-1.5 text-[11.5px] font-semibold text-slate-700 outline-none focus:border-sky-500"
                        >
                          <option value="CASH">Cash</option>
                          <option value="UPI">UPI</option>
                          <option value="CARD">Card</option>
                        </select>
                        <div className="relative">
                          <span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">
                            ₹
                          </span>
                          <input
                            id="udhar-paid"
                            inputMode="decimal"
                            value={udharPaidRaw}
                            onChange={(e) => setUdharPaidRaw(e.target.value.replace(/[^\d.]/g, ""))}
                            placeholder="0"
                            aria-invalid={!udharPaidValid || undefined}
                            className="min-h-11 lg:h-8 w-24 rounded-lg border border-slate-200 bg-white pl-6 pr-2 text-right text-[13px] font-bold tabular-nums text-slate-900 outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15"
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
                    </dl>
                  </>
                )}
                {udharProblem && customer && cart.length > 0 && (
                  <p className="text-[11.5px] font-medium text-rose-700">{udharProblem}</p>
                )}
              </div>
            )}

            {/* Fast Bill Note / Delivery Instruction Tag */}
            <div className="mb-2">
              <button
                type="button"
                onClick={() => setBillNoteOpen((o) => !o)}
                className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                  billNote.trim()
                    ? "border-sky-300 bg-sky-50/70 text-sky-800"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <StickyNote className="h-3.5 w-3.5 text-sky-600" />
                  {billNote.trim() ? "Bill Note Attached" : "Add Bill Note / Delivery Tag"}
                </span>
                <span className="text-[11px] font-semibold text-sky-700">
                  {billNoteOpen ? "Hide" : billNote.trim() ? "Edit" : "+ Add"}
                </span>
              </button>

              {billNoteOpen && (
                <div className="mt-1.5 space-y-1">
                  <textarea
                    value={billNote}
                    onChange={(e) => setBillNote(e.target.value.slice(0, 120))}
                    placeholder="e.g. Gift wrap, Delivery by 6 PM, Alter sleeves 1 inch..."
                    rows={2}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/15"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Prints on customer receipt</span>
                    <span>{billNote.length}/120</span>
                  </div>
                </div>
              )}
            </div>

            {priceChange && (
              <div role="alert" className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                <span>
                  Price of {priceChange.productName} changed to {formatMinor(priceChange.currentPriceMinor)}. Update the bill?
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 font-bold text-white hover:bg-amber-700"
                  onClick={() => {
                    const change = priceChange;
                    setCart((current) =>
                      current.map((l) =>
                        l.variantId === change.variantId && l.unitPriceMinor === change.sentPriceMinor
                          ? {
                              ...l,
                              unitPriceMinor: change.currentPriceMinor,
                              originalUnitPriceMinor: undefined,
                              lineDiscountReason: undefined,
                              batchChoice: undefined,
                            }
                          : l,
                      ),
                    );
                    setPriceChange(null);
                    setSaleError(null);
                  }}
                >
                  Update
                </button>
              </div>
            )}

            {saleError && (
              <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {saleError}
              </p>
            )}

            {udharApproval.needed && method === "UDHAR" && (
              <div className="amb-fade-in mt-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-900">Approve udhar without phone verification</p>
                {(props.approvers ?? []).length === 0 ? (
                  <p className="text-xs text-amber-900">
                    No owner or store manager has a PIN yet. Set one in Settings → Your PIN, or verify the customer&apos;s phone.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label="Who approves this udhar"
                      value={udharApproval.approverId}
                      onChange={(e) => setUdharApproval((u) => ({ ...u, approverId: e.target.value }))}
                      className="h-11 min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-2 text-xs"
                    >
                      <option value="">Who approves?</option>
                      {(props.approvers ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={6}
                      aria-label="Approver's PIN"
                      placeholder="PIN"
                      value={udharApproval.pin}
                      onChange={(e) => setUdharApproval((u) => ({ ...u, pin: e.target.value.replace(/\D/g, "") }))}
                      className="h-11 w-24 rounded-lg border border-amber-300 bg-white px-2 text-center text-sm tracking-widest"
                    />
                  </div>
                )}
                <p className="text-[11px] text-amber-800">The approval is recorded with the bill. Then press Complete sale again.</p>
              </div>
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

      <ApplyOfferModal
        isOpen={offerModalOpen}
        onClose={() => setOfferModalOpen(false)}
        cartTotalMinor={totals.subtotalMinor}
        activePromos={promoEvaluation.promotionsApplied.map((p) => p.ruleId)}
        selectedOfferId={selectedOfferId}
        onSelectOffer={setSelectedOfferId}
        userRole={props.mayGiveLargeDiscount ? "OWNER" : "CASHIER"}
      />

      <SalesPersonModal
        isOpen={salesPersonModalOpen}
        onClose={() => setSalesPersonModalOpen(false)}
        selectedStaff={salesPerson}
        onSelect={setSalesPerson}
      />

      <MoreActionsModal
        isOpen={moreActionsModalOpen}
        onClose={() => setMoreActionsModalOpen(false)}
        onReprintLast={lastCompletedReceipt ? handleReprintLastBill : undefined}
      />

      <PosHelpModal
        isOpen={helpModalOpen}
        onClose={() => setHelpModalOpen(false)}
      />

      <LineDiscountModal
        isOpen={Boolean(lineDiscountLine)}
        onClose={() => setLineDiscountLine(null)}
        line={lineDiscountLine}
        mayGiveLargeDiscount={props.mayGiveLargeDiscount}
        onApply={(newPriceMinor, reason) => {
          if (!lineDiscountLine) return;
          setCart((prev) =>
            prev.map((item) => {
              if (item.variantId !== lineDiscountLine.variantId) return item;
              const original = item.originalUnitPriceMinor ?? item.unitPriceMinor;
              return {
                ...item,
                originalUnitPriceMinor: original,
                unitPriceMinor: newPriceMinor,
                lineDiscountReason: reason,
              };
            })
          );
        }}
        onReset={() => {
          if (!lineDiscountLine) return;
          setCart((prev) =>
            prev.map((item) => {
              if (item.variantId !== lineDiscountLine.variantId) return item;
              const original = item.originalUnitPriceMinor ?? item.unitPriceMinor;
              return {
                ...item,
                unitPriceMinor: original,
                originalUnitPriceMinor: undefined,
                lineDiscountReason: undefined,
              };
            })
          );
        }}
      />

      {/* Multi-MRP Batch Selection Modal (Edge Cases 2 & 4) */}
      {pendingMrpItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mrp-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in"
          onKeyDown={(e) => {
            if (e.key === "1") {
              e.preventDefault();
              setSelectedBatchIndex(0);
            } else if (e.key === "2") {
              e.preventDefault();
              setSelectedBatchIndex(1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              setSelectedBatchIndex(0);
            } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              setSelectedBatchIndex(1);
            } else if (e.key === "Enter") {
              e.preventDefault();
              const p = pendingMrpItem.pendingPrices[0];
              if (selectedBatchIndex === 0) {
                // Batch 1: Old Stock at default hit.priceMinor
                addToCart(pendingMrpItem.hit, pendingMrpItem.hit.priceMinor, "old");
              } else if (p) {
                // Batch 2: New Stock at p.priceMinor
                addToCart(pendingMrpItem.hit, p.priceMinor, "new");
              }
              setPendingMrpItem(null);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setPendingMrpItem(null);
            }
          }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200 mb-1.5">
                  <Tag className="h-3.5 w-3.5" /> Multi-MRP Batch Detected
                </span>
                <h3 id="mrp-modal-title" className="text-base font-bold text-slate-900">
                  Select Tag Price for {pendingMrpItem.hit.productName}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Check the physical price printed on the customer&apos;s item tag. Press <kbd className="rounded border bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-700">1</kbd> or <kbd className="rounded border bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-700">2</kbd> then <kbd className="rounded border bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-700">Enter</kbd>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingMrpItem(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Batch Options Grid */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              {/* Option 1: Old Stock Batch */}
              {(() => {
                const opt = pendingMrpItem.pendingPrices[0];
                const oldLeft = opt?.oldStockRemaining ?? opt?.unitsAhead ?? 0;
                const isSelected = selectedBatchIndex === 0;
                return (
                  <button
                    type="button"
                    autoFocus
                    onClick={() => {
                      addToCart(pendingMrpItem.hit, pendingMrpItem.hit.priceMinor, "old");
                      setPendingMrpItem(null);
                    }}
                    onFocus={() => setSelectedBatchIndex(0)}
                    className={`flex flex-col rounded-xl border p-4 text-left transition-all ${
                      isSelected
                        ? "border-sky-500 bg-sky-50/70 ring-2 ring-sky-500 shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                        1
                      </span>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                        {oldLeft} {oldLeft === 1 ? "unit" : "units"} left
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-600">Old Stock Batch</p>
                    <p className="text-xl font-extrabold text-slate-900">
                      {formatMinor(pendingMrpItem.hit.priceMinor)}
                    </p>
                    {pendingMrpItem.hit.mrpMinor && pendingMrpItem.hit.mrpMinor > pendingMrpItem.hit.priceMinor && (
                      <p className="text-[11px] text-slate-400 line-through">
                        MRP {formatMinor(pendingMrpItem.hit.mrpMinor)}
                      </p>
                    )}
                  </button>
                );
              })()}

              {/* Option 2: New Stock Batch */}
              {(() => {
                const opt = pendingMrpItem.pendingPrices[0];
                if (!opt) return null;
                const newLeft = opt.newStockRemaining ?? 0;
                const isSelected = selectedBatchIndex === 1;
                return (
                  <button
                    type="button"
                    onClick={() => {
                      addToCart(pendingMrpItem.hit, opt.priceMinor, "new");
                      setPendingMrpItem(null);
                    }}
                    onFocus={() => setSelectedBatchIndex(1)}
                    className={`flex flex-col rounded-xl border p-4 text-left transition-all ${
                      isSelected
                        ? "border-sky-500 bg-sky-50/70 ring-2 ring-sky-500 shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                        2
                      </span>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                        {newLeft} {newLeft === 1 ? "unit" : "units"} left
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-600">New Stock Batch</p>
                    <p className="text-xl font-extrabold text-slate-900">
                      {formatMinor(opt.priceMinor)}
                    </p>
                    {opt.mrpMinor && opt.mrpMinor > opt.priceMinor && (
                      <p className="text-[11px] text-slate-400 line-through">
                        MRP {formatMinor(opt.mrpMinor)}
                      </p>
                    )}
                  </button>
                );
              })()}
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-[11px] text-slate-400">
                Auto-bills without prompt once either batch sells out.
              </span>
              <button
                type="button"
                onClick={() => {
                  const p = pendingMrpItem.pendingPrices[0];
                  if (selectedBatchIndex === 0) {
                    addToCart(pendingMrpItem.hit, pendingMrpItem.hit.priceMinor, "old");
                  } else if (p) {
                    addToCart(pendingMrpItem.hit, p.priceMinor, "new");
                  }
                  setPendingMrpItem(null);
                }}
                className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-xs font-bold text-white shadow-sm hover:bg-primary-hover"
              >
                Confirm (Enter ↵)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Device Camera Barcode Scanner Modal */}
      <CameraBarcodeScannerModal
        isOpen={cameraScannerOpen}
        onClose={() => setCameraScannerOpen(false)}
        onScan={(barcode) => {
          setCameraScannerOpen(false);
          void scanBarcodeValue(barcode);
        }}
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
      {hotkey && <span className="text-[11px] text-slate-500 [@media(max-height:820px)]:hidden">({hotkey})</span>}
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
    ...(r.billNote ? [`Note: ${r.billNote}`] : []),
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

  const [thermalModalOpen, setThermalModalOpen] = useState(false);

  function printReceipt() {
    setThermalModalOpen(true);
  }

  const thermalReceiptData: ReceiptData | null = receipt ? {
    storeName: receipt.storeName,
    storeAddress: [receipt.storeAddressLine, receipt.storeCity, receipt.storeState, receipt.storePostalCode].filter(Boolean).join(", "),
    billNumber: receipt.billNumber,
    date: receipt.completedAt,
    cashierName: receipt.cashierName,
    terminalName: "POS Terminal",
    customerName: receipt.customer?.name ?? null,
    customerPhone: receipt.customer?.phone ?? null,
    items: receipt.items.map((i) => ({
      name: i.name,
      variant: [i.size, i.colour].filter(Boolean).join(" / ") || null,
      sku: i.sku,
      quantity: i.quantity,
      unitPriceMinor: i.unitPriceMinor,
      totalMinor: i.lineTotalMinor,
    })),
    subtotalMinor: receipt.subtotalMinor,
    discountMinor: receipt.discountMinor,
    cgstMinor: Math.round(receipt.taxMinor / 2),
    sgstMinor: Math.round(receipt.taxMinor / 2),
    totalMinor: receipt.totalMinor,
    payments: receipt.payments.map((p) => ({
      method: p.method,
      amountMinor: p.amountMinor,
      reference: p.reference,
    })),
    footerMessage: "Thank you for shopping! Exchange valid for 7 days with original tag & bill.",
  } : null;

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
              ["right-8 top-0", "bg-primary", "size-2 rotate-45 rounded-[2px]"],
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
                  className="rounded p-0.5 text-slate-500 transition-colors hover:bg-white hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-600"
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

          {/* Customer Digital e-Receipt QR Card */}
          <div className="mt-4 flex items-center gap-3.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
            <DigitalReceiptQr
              value={typeof window !== "undefined" ? `${window.location.origin}/sales/${sale.id}` : `/sales/${sale.id}`}
              size={88}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <span className="inline-block rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800 uppercase tracking-wider">
                Digital e-Bill
              </span>
              <h4 className="mt-1 text-xs font-bold text-slate-900">Instant Customer Self-Scan</h4>
              <p className="mt-0.5 text-[11px] text-slate-500 leading-snug">
                Customer can scan this QR with any smartphone camera to open and save their GST e-bill instantly.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3.5">
            <button
              ref={printAction}
              type="button"
              onClick={printReceipt}
              disabled={!receipt}
              aria-keyshortcuts="F3"
              data-testid="success-print"
              className="amb-press inline-flex h-[52px] w-full items-center justify-center gap-2.5 rounded-lg bg-primary text-[16px] font-semibold text-white shadow-sm shadow-sky-700/25 transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:bg-slate-300"
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
              className="inline-flex h-[52px] w-full items-center justify-center gap-2.5 rounded-lg border border-slate-200 bg-white text-[15px] font-medium text-slate-800 transition-colors hover:border-sky-200 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:text-slate-500 disabled:hover:bg-white"
            >
              <Download className="h-5 w-5 text-sky-600" />
              Download PDF
            </button>

            <div className="grid grid-cols-2 gap-3.5">
              {receipt ? (
                <WhatsAppReceiptButton
                  billNumber={receipt.billNumber}
                  customerName={receipt.customer?.name}
                  customerPhone={receipt.customer?.phone}
                  storeName={receipt.storeName}
                  totalMinor={receipt.totalMinor}
                  saleId={sale.id}
                  variant="action-tile"
                />
              ) : (
                <button type="button" disabled className="inline-flex h-[52px] cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-[14px] font-medium text-slate-500">
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
                <button type="button" disabled className="inline-flex h-[52px] cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-[14px] font-medium text-slate-500">
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

            <button type="button" disabled title="Open the bill from Sales to return it. Exchanges are not available yet." className="inline-flex h-[52px] w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-lg border border-slate-200 bg-white text-[15px] font-medium text-slate-500">
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
            Accounting is not connected, so PENDING is the truthful state and the only thing this
            screen may say about it. It must never read as "posted" — schema.prisma says so at
            the column, and the receipt deliberately carries no invoice number for the same
            reason: AMBURAX allocates a bill number, accounting allocates invoice numbers, and
            only one of those has happened.
          */}
          {erpPending && (
            <p
              className="mt-4 text-center text-[11px] text-slate-500"
              data-testid="success-backend-status"
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
              className="pos-receipt-paper mx-auto max-w-[320px] bg-white px-5 pb-7 pt-6 font-mono text-[11px] leading-tight text-slate-800 shadow-sm print:max-w-none print:shadow-none print:text-black"
            >
              {/* Header — store identity */}
              <div className="text-center">
                <p className="text-[17px] font-bold tracking-tight text-slate-900 uppercase">
                  {receipt.storeName}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-slate-600">
                  {receipt.storeAddressLine}
                  {receipt.storeCity ? `, ${receipt.storeCity}` : ""}
                  {receipt.storePostalCode ? ` ${receipt.storePostalCode}` : ""}
                </p>
                {receipt.storePhone && (
                  <p className="mt-0.5 text-[11px] text-slate-600">Tel: {receipt.storePhone}</p>
                )}
              </div>

              <div className="my-2 border-b border-dashed border-slate-400" />

              {/* Bill Number (Centered, Prominent) */}
              <div className="text-center font-bold text-[18px] tracking-wider text-slate-950 py-0.5">
                {receipt.billNumber}
              </div>

              <div className="flex justify-between text-[11px] text-slate-600">
                <span>
                  {new Date(receipt.completedAt).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "2-digit",
                  })}{" "}
                  {new Date(receipt.completedAt).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </span>
                <span>Staff: {receipt.cashierName}</span>
              </div>

              {receipt.customer && (
                <div className="mt-1 text-[11px] text-slate-700" data-testid="receipt-customer">
                  Customer: {receipt.customer.name}
                  {receipt.customer.phone ? ` (${receipt.customer.phone})` : ""}
                </div>
              )}

              {receipt.billNote && (
                <div className="mt-1.5 rounded bg-amber-50/70 p-1.5 border border-amber-200/80 text-[10px] text-amber-950 font-medium">
                  Note: {receipt.billNote}
                </div>
              )}

              <div className="my-2 border-b border-dashed border-slate-400" />

              {/* Items: Indian 2-Line Architecture */}
              <div className="space-y-2" data-testid="receipt-items">
                {receipt.items.map((item) => {
                  const variant = [item.size, item.colour].filter(Boolean).join(" ");
                  const qtyDesc = variant ? `${item.quantity} x ${variant}` : `${item.quantity} x ${Math.round(item.unitPriceMinor / 100)}`;
                  return (
                    <div key={item.id} className="leading-snug">
                      <div className="font-bold text-slate-900">{item.name}</div>
                      <div className="flex justify-between pl-2 text-slate-700">
                        <span>{qtyDesc}</span>
                        <span className="font-semibold text-slate-900">
                          {Math.round(item.lineTotalMinor / 100).toLocaleString("en-IN")}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="my-2 border-b border-dashed border-slate-400" />

              {/* Totals & Discounts */}
              <dl className="space-y-1 text-slate-700">
                <div className="flex justify-between">
                  <dt>Subtotal</dt>
                  <dd>{Math.round((receipt.totalMinor + receipt.discountMinor) / 100).toLocaleString("en-IN")}</dd>
                </div>
                {receipt.discountMinor > 0 && (
                  <div className="flex justify-between text-emerald-700" data-testid="receipt-discount">
                    <dt>Discount ({Math.round(receipt.discountMinor / 100).toLocaleString("en-IN")})</dt>
                    <dd>-{Math.round(receipt.discountMinor / 100).toLocaleString("en-IN")}</dd>
                  </div>
                )}
              </dl>

              <div className="my-2 border-b border-dashed border-slate-400" />

              {/* NET TOTAL */}
              <div className="flex justify-between items-baseline font-bold text-[16px] text-slate-950 py-0.5">
                <span>TOTAL</span>
                <span data-testid="receipt-total">
                  INR {Math.round(receipt.totalMinor / 100).toLocaleString("en-IN")}
                </span>
              </div>

              <div className="my-2 border-b border-dashed border-slate-400" />

              {/* Tendered Payments */}
              <div className="space-y-1 text-slate-700" data-testid="receipt-payments">
                {receipt.payments.map((p, i) => (
                  <div key={`${p.method}-${i}`} className="flex justify-between">
                    <span>
                      {p.method} Received
                      {p.reference ? (
                        <span className="block text-[10px] text-slate-500">{p.reference}</span>
                      ) : null}
                    </span>
                    <span className="font-medium text-slate-900">
                      {Math.round(p.amountMinor / 100).toLocaleString("en-IN")}
                    </span>
                  </div>
                ))}
              </div>

              {onKhataMinor > 0 && (
                <div className="mt-1 flex justify-between font-semibold text-slate-900" data-testid="receipt-on-khata">
                  <span>On khata (udhar)</span>
                  <span>{formatMinor(onKhataMinor)}</span>
                </div>
              )}
              {changeMinor > 0 && (
                <div className="mt-1 flex justify-between font-semibold text-slate-900">
                  <span>Change</span>
                  <span data-testid="receipt-change">{formatMinor(changeMinor)}</span>
                </div>
              )}

              <div className="my-2 border-b border-dashed border-slate-400" />

              {/* Footer */}
              <div className="mt-3 text-center">
                <p className="font-bold text-[11px] text-slate-900">Exchange Within 3 Days / No Return</p>
                <p className="mt-1 text-[9px] text-slate-500">Powered by AMBURAX POS · www.amburax.com</p>
              </div>
            </div>
          ) : receiptFailed ? (
            <div className="flex h-full min-h-[12rem] items-center justify-center px-6 text-center">
              <p className="text-[12px] text-slate-600" data-testid="receipt-unavailable">
                The sale is recorded and the bill number above is final. The printable receipt
                could not be loaded — open{" "}
                <Link href={`/sales/${sale.id}`} className="font-semibold text-primary underline hover:text-primary-hover">
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

      {thermalReceiptData && (
        <ThermalPrinterModal
          isOpen={thermalModalOpen}
          onClose={() => setThermalModalOpen(false)}
          receiptData={thermalReceiptData}
        />
      )}
    </div>
  );
}
