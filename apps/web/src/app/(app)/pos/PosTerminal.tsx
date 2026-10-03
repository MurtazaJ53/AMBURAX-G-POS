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
import { Search, Plus, Minus, Trash2, Package, LayoutGrid, CheckCircle2, SlidersHorizontal, Barcode, Zap, ChevronDown, AlignJustify, Shirt, Users, Tag, Baby, Gem, Footprints, Sparkles, Flame, Briefcase, Printer, FileText, X, Copy, Check } from "lucide-react";
import { formatDateTime } from "@/app/(app)/sales/formatDateTime";

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

interface CustomerHit {
  id: string;
  name: string;
  phone: string | null;
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

type PaymentMethod = "CASH" | "UPI" | "CARD" | "SPLIT" | "MORE";

/**
 * The methods a single split row may carry.
 *
 * Narrower than `PaymentMethod` on purpose: "SPLIT" and "MORE" are modes of this panel, not ways
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
  { value: "MORE", label: "More" },
];

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
  
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [amountReceived, setAmountReceived] = useState<number | null>(null);

  const [splitPayments, setSplitPayments] = useState<SplitRow[]>([
    { id: "1", method: "CASH", amount: null, reference: "" },
    { id: "2", method: "UPI", amount: null, reference: "" }
  ]);
  
  const [submitting, setSubmitting] = useState(false);
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

  const term = query.trim();

  useEffect(() => {
    const current = query.trim();
    if (current.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearch(EMPTY_SEARCH);
      return;
    }

    const seq = ++requestSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/catalog/search?q=${encodeURIComponent(current)}`);
        const data = await res.json();
        if (seq !== requestSeq.current) return;
        setSearch(
          res.ok
            ? { term: current, results: data.results as CatalogHit[], error: null }
            : {
                term: current,
                results: [],
                error: data?.error?.message ?? "Product lookup failed.",
              },
        );
      } catch {
        if (seq !== requestSeq.current) return;
        setSearch({
          term: current,
          results: [],
          error: "Product lookup failed. Check the connection and try again.",
        });
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  const settled = search.term === term;
  const results = settled ? search.results : [];
  const searchError = settled ? search.error : null;
  const searching = term.length > 0 && !settled;

  // Add some fallback mock products if empty search (to simulate initial load)
  // But wait, the prompt says DO NOT USE MOCK REFERENCE IMAGES, USE REAL DATA.
  // We can just trigger an empty search by default in backend?
  // Our backend doesn't support empty search out of the box unless we pass q="", which it handles.
  useEffect(() => {
    if (term.length === 0) {
      fetch(`/api/v1/catalog/search?q=`)
        .then(r => r.json())
        .then(data => {
          if (data.results && requestSeq.current === 0) {
            setSearch({ term: "", results: data.results, error: null });
          }
        })
        .catch(() => {});
    }
  }, [term]);

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

  function startNewSale() {
    setCart([]);
    setCustomer(null);
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

        "MORE" keeps its CASH fallback. It has no interaction design and no implementation behind
        it, and inventing one is not this gate's job.
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
          ...(splitRows
            ? { payments: splitRows }
            : {
                payment: {
                  method: method === "MORE" ? "CASH" : method,
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
        erpSyncStatus: data.sale.erpSyncStatus,
        duplicate: Boolean(data.duplicate),
      });
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
    <div className="flex w-full h-[calc(100vh-68px)] overflow-y-auto lg:overflow-hidden bg-slate-50 flex-col lg:flex-row print:hidden">
      {/* Left Workspace (Products) - 70% */}
      <div className="flex-1 flex flex-col min-w-0 bg-white border-r border-slate-200 min-h-[500px] lg:min-h-0 shrink-0 lg:shrink">
        
        {/* Top Tabs */}
        <div className="flex px-4 pt-3 border-b border-slate-200 gap-6 text-[13px] font-medium">
          <button className="pb-2.5 border-b-2 border-blue-600 text-blue-600">Products</button>
          <button className="pb-2.5 border-b-2 border-transparent text-slate-500 hover:text-slate-700">Barcode Scan</button>
          <button className="pb-2.5 border-b-2 border-transparent text-slate-500 hover:text-slate-700">Quick Add</button>
        </div>

        {/* Filter Toolbar */}
        <div className="p-4 flex flex-col gap-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                ref={searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products by name, SKU, barcode..."
                className="w-full pl-9 py-2.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors">
              <Barcode className="w-4 h-4" />
              <span className="text-[13px] font-medium">Scan</span>
            </button>
          </div>
          
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-[12px]">
            <button className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-md text-slate-600 whitespace-nowrap hover:bg-slate-50">All Categories <ChevronDown className="w-3 h-3"/></button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-md text-slate-600 whitespace-nowrap hover:bg-slate-50">All Brands <ChevronDown className="w-3 h-3"/></button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-md text-slate-600 whitespace-nowrap hover:bg-slate-50">All Genders <ChevronDown className="w-3 h-3"/></button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-md text-slate-600 whitespace-nowrap hover:bg-slate-50">All Sizes <ChevronDown className="w-3 h-3"/></button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-md text-slate-600 whitespace-nowrap hover:bg-slate-50">All Colors <ChevronDown className="w-3 h-3"/></button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-md text-slate-600 whitespace-nowrap hover:bg-slate-50">Price <ChevronDown className="w-3 h-3"/></button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-md text-blue-600 font-medium whitespace-nowrap hover:bg-blue-50 ml-auto"><SlidersHorizontal className="w-3 h-3"/> More Filters</button>
            
            <div className="h-4 w-px bg-slate-200 mx-2"></div>
            <span className="text-slate-500 mr-1">View:</span>
            <button className="p-1.5 text-blue-600 bg-blue-50 rounded"><LayoutGrid className="w-4 h-4"/></button>
            <button className="p-1.5 text-slate-400 hover:text-slate-600 rounded"><AlignJustify className="w-4 h-4"/></button>
          </div>
        </div>

        {/* Categories row (Visual only) */}
        <div className="px-4 py-2 flex gap-3 overflow-x-auto border-b border-slate-100 no-scrollbar">
             {[
               { name: 'Men\'s Wear', icon: Shirt },
               { name: 'Women\'s Wear', icon: Sparkles },
               { name: 'Kids Wear', icon: Baby },
               { name: 'Ethnic Wear', icon: Flame },
               { name: 'Footwear', icon: Footprints },
               { name: 'Accessories', icon: Briefcase },
               { name: 'Innerwear', icon: Tag },
               { name: 'New Arrivals', icon: Zap },
               { name: 'Offers', icon: Gem },
             ].map(cat => (
               <div key={cat.name} className="flex flex-col items-center gap-1.5 min-w-[72px] cursor-pointer group">
                  <div className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 group-hover:border-blue-200 group-hover:bg-blue-50">
                    <cat.icon className="w-5 h-5"/>
                  </div>
                  <span className="text-[11px] font-medium text-slate-600 text-center">{cat.name}</span>
               </div>
             ))}
          </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50">
           {searchError && <p className="text-[13px] text-rose-600 bg-rose-50 p-3 rounded-lg border border-rose-100">{searchError}</p>}
           
           <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
             {results.map(hit => (
               <button 
                 key={hit.variantId} 
                 onClick={() => addToCart(hit)}
                 className="flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow text-left group"
               >
                 <div className="aspect-square bg-slate-100 relative w-full border-b border-slate-100 flex items-center justify-center">
                    {hit.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={hit.imageUrl} alt={hit.productName} className="w-full h-full object-cover" />
                    ) : (
                      <Package className="w-8 h-8 text-slate-300" />
                    )}
                 </div>
                 <div className="p-3 flex flex-col gap-1.5">
                   <p className="text-[12px] font-medium text-slate-900 line-clamp-2 leading-snug">{hit.productName}</p>
                   <div className="flex justify-between items-end mt-1">
                     <div>
                       <p className="text-[15px] font-bold text-slate-900 leading-none">{formatMinor(hit.priceMinor)}</p>
                       <p className="text-[11px] text-slate-500 mt-1 truncate max-w-[100px]">{hit.sku}</p>
                     </div>
                     <div className="flex items-center gap-1">
                       <div className={`w-1.5 h-1.5 rounded-full ${hit.stockQuantity && hit.stockQuantity > 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
                       <span className="text-[10px] font-medium text-slate-600">{hit.stockQuantity ? `In Stock (${hit.stockQuantity})` : 'Out of stock'}</span>
                     </div>
                   </div>
                 </div>
               </button>
             ))}
           </div>
        </div>

        {/* Quick Actions Footer */}
        <div className="p-4 border-t border-slate-200 bg-white">
          <p className="text-[12px] font-semibold text-slate-800 mb-3">Quick Actions</p>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
             <ActionBtn icon={<span className="font-bold text-base">||</span>} label="Hold Bill" hotkey="(F3)" disabled />
             <ActionBtn icon={<AlignJustify className="w-4 h-4"/>} label="Retrieve Bill" hotkey="(F4)" disabled />
             <ActionBtn icon={<Users className="w-4 h-4"/>} label="New Customer" hotkey="(F5)" disabled />
             <ActionBtn icon={<Tag className="w-4 h-4"/>} label="Apply Offer" hotkey="(F6)" disabled />
             <ActionBtn icon={<Users className="w-4 h-4"/>} label="Sales Person" hotkey="(F7)" disabled />
             <ActionBtn icon={<span className="font-bold text-lg leading-none">...</span>} label="More Actions" />
          </div>
        </div>
      </div>

      {/* Right Checkout Panel - Hard Reset */}
      <div className="w-full lg:w-[390px] shrink-0 flex flex-col bg-slate-50 lg:border-l border-slate-200 h-[600px] lg:h-full relative">
        
        {/* Header (~50px) */}
        <div className="flex px-4 h-[50px] shrink-0 items-center border-b border-slate-200 gap-5 text-[13px] font-medium bg-white">
          <button className="h-full flex items-center border-b-2 border-blue-600 text-blue-600 font-bold px-1">Cart ({cart.reduce((a,b)=>a+b.quantity, 0)})</button>
          <button className="h-full flex items-center border-b-2 border-transparent text-slate-500 hover:text-slate-700 px-1">Customer</button>
        </div>

        {/* Customer Block (~80px) */}
        <div className="px-3 h-[80px] flex items-center bg-white border-b border-slate-200 shrink-0 shadow-sm z-10">
          <CustomerPicker customer={customer} onChange={setCustomer} />
        </div>

        {/* Cart Items (Scrollable) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2 bg-slate-50/50">
          {cartNotice && (
             <p className="text-[12px] text-rose-700 bg-rose-50 p-2 rounded shrink-0">{cartNotice}</p>
          )}
          {cart.map((line) => (
             <div key={line.variantId} className="flex gap-2.5 bg-white p-2 min-h-[94px] rounded-[6px] border border-slate-200 shadow-sm relative group shrink-0">
                <div className="w-10 h-10 bg-slate-100 rounded-[4px] border border-slate-100 flex items-center justify-center overflow-hidden shrink-0 mt-0.5">
                   {line.imageUrl ? (
                     /* eslint-disable-next-line @next/next/no-img-element */
                     <img src={line.imageUrl} alt={line.productName} className="w-full h-full object-cover" />
                   ) : (
                     <Package className="w-5 h-5 text-slate-300" />
                   )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col">
                   <div className="pr-6 leading-tight mb-2">
                     <p className="text-[12px] font-semibold text-slate-900 truncate">{line.productName}</p>
                     <p className="text-[10px] text-slate-500 truncate mt-0.5">{line.sku} {variantLabel(line) ? `| ${variantLabel(line)}` : ''}</p>
                   </div>
                   <div className="flex items-center justify-between mt-auto">
                     <p className="text-[12px] font-semibold text-slate-900">{formatMinor(line.unitPriceMinor)}</p>
                     
                     <div className="flex items-center border border-slate-200 rounded text-slate-700 bg-white h-[30px] shrink-0 overflow-hidden shadow-sm">
                        <button onClick={() => setQuantity(line.variantId, line.quantity - 1)} className="w-7 h-full flex items-center justify-center hover:bg-slate-100 transition-colors bg-slate-50 border-r border-slate-200"><Minus className="w-[14px] h-[14px]"/></button>
                        <span className="w-8 text-center text-[12px] font-bold flex items-center justify-center h-full">{line.quantity}</span>
                        <button onClick={() => setQuantity(line.variantId, line.quantity + 1)} className="w-7 h-full flex items-center justify-center hover:bg-slate-100 transition-colors bg-slate-50 border-l border-slate-200"><Plus className="w-[14px] h-[14px]"/></button>
                     </div>
                   </div>
                </div>
                <button onClick={() => setQuantity(line.variantId, 0)} className="absolute top-2 right-2 text-slate-300 hover:text-rose-500 transition-colors">
                  <Trash2 className="w-[16px] h-[16px]"/>
                </button>
             </div>
          ))}
          {cart.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
               <Package className="w-10 h-10 mb-2 text-slate-300 opacity-50" />
               <p className="text-[12px] font-medium">Cart is empty</p>
            </div>
          )}
        </div>

        {/* Checkout Footer (Fixed) */}
        <div className="bg-white border-t border-slate-200 p-3 flex flex-col shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.03)] z-20">
           
           {/* Discount */}
           <div className="flex gap-2">
             <input disabled placeholder="Add Discount" className="flex-1 text-[12px] border border-slate-200 rounded-[6px] px-2.5 h-[34px] bg-slate-50 text-slate-500 outline-none" />
             <div className="flex border border-slate-200 rounded-[6px] overflow-hidden bg-white">
               <button disabled className="px-2.5 h-[34px] border-r border-slate-200 text-[12px] font-medium text-slate-600 bg-slate-50">%</button>
               <button disabled className="px-2.5 h-[34px] text-[12px] font-bold text-slate-700 bg-white">₹</button>
             </div>
             <button disabled className="px-4 h-[34px] bg-slate-100 border border-slate-200 rounded-[6px] text-[12px] font-semibold text-slate-400">Apply</button>
           </div>
           
           <div className="h-px bg-slate-100 w-full my-1.5"></div>

           {/* Totals */}
           <div className="flex flex-col text-[12px]">
              <div className="flex justify-between items-center h-[24px] text-slate-600">
                <span>Items ({cart.reduce((a,b)=>a+b.quantity,0)})</span>
                <span className="font-semibold text-slate-900">{formatMinor(totals.subtotalMinor)}</span>
              </div>
              <div className="flex justify-between items-center h-[24px] text-slate-600">
                <span>Discount</span>
                <span className="text-slate-400">—</span>
              </div>
              <div className="flex justify-between items-center h-[24px] text-slate-600">
                <span>Subtotal</span>
                <span className="text-slate-400">—</span>
              </div>
              <div className="flex justify-between items-center h-[24px] text-slate-600">
                <span>GST / Tax</span>
                <span className="text-slate-400">—</span>
              </div>
              
              <div className="flex justify-between items-center h-[30px] border-t border-slate-100 mt-1 pt-1">
                <span className="text-[16px] font-bold text-slate-900">Total Amount</span>
                <span className="text-[18px] font-bold text-blue-700">{formatMinor(totals.totalMinor)}</span>
              </div>
           </div>

           <div className="h-px bg-slate-100 w-full my-2"></div>

           {/* Payment Modes */}
           <div>
             <div className="flex gap-1.5 h-[34px]">
               {PAYMENT_METHODS.map(m => (
                 <button
                   key={m.value}
                   type="button"
                   aria-pressed={method === m.value}
                   onClick={() => {
                     setMethod(m.value);
                     if (m.value !== "SPLIT") {
                       setAmountReceived(null);
                     }
                   }}
                   className={`flex-1 text-[11px] font-bold rounded-[6px] border transition-colors ${method === m.value ? 'bg-[#10b981] border-[#10b981] text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                 >
                   {m.label}
                 </button>
               ))}
             </div>
           </div>

           {/* Single Payment: Cash Amount Received */}
           {method === 'CASH' && (
             <div className="flex flex-col mt-2">
                <div className="flex justify-between items-center mb-1.5">
                  {/* A real label/for pair: the text is already on screen, so it should name the field. */}
                  <label htmlFor="amount-received" className="text-[12px] font-semibold text-slate-600">Amount Received</label>
                  <input
                    id="amount-received"
                    type="number"
                    value={amountReceived ?? ''}
                    onChange={(e) => setAmountReceived(e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder={formatMinor(totals.totalMinor)}
                    className="w-28 text-right text-[13px] font-bold border border-slate-200 rounded-[6px] px-2 h-[34px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="flex gap-1 h-[30px] mb-1.5">
                  <button onClick={() => setAmountReceived((totals.totalMinor/100) + 1)} className="flex-1 text-[11px] border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 rounded-[6px] font-semibold">+1</button>
                  <button onClick={() => setAmountReceived((totals.totalMinor/100) + 10)} className="flex-1 text-[11px] border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 rounded-[6px] font-semibold">+10</button>
                  <button onClick={() => setAmountReceived((totals.totalMinor/100) + 100)} className="flex-1 text-[11px] border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 rounded-[6px] font-semibold">+100</button>
                  <button onClick={() => setAmountReceived(totals.totalMinor/100)} className="flex-[1.2] text-[11px] border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-[6px] font-bold">Exact</button>
                </div>
                <div className="flex justify-between items-center text-[13px] h-[26px]">
                  <span className="font-semibold text-slate-500">Balance</span>
                  <span className="font-bold text-slate-900">
                    {amountReceived && amountReceived * 100 >= totals.totalMinor 
                      ? formatMinor(Math.round(amountReceived * 100) - totals.totalMinor) 
                      : "—"}
                  </span>
                </div>
             </div>
           )}

           {/* Split Payment */}
           {method === 'SPLIT' && (
             <div className="flex flex-col mt-2 gap-2 max-h-[160px] overflow-y-auto pr-1 no-scrollbar">
                {splitPayments.map((p, i) => (
                  <div key={p.id} className="flex gap-1.5 items-center bg-white border border-slate-200 rounded-[6px] p-1.5">
                    {/*
                      Every control in a split row is labelled by its row number. There is no
                      visible label to point a <label> at — the row is a dense strip of controls
                      the design gives no room for one — and "Amt" repeated four times tells a
                      screen-reader user which column they are in but not which payment. The
                      position is the only thing that distinguishes one row from another, so the
                      position is what the accessible name carries.
                    */}
                    <select
                      aria-label={`Payment ${i + 1} method`}
                      value={p.method}
                      onChange={(e) => setSplitPayments(curr => curr.map(x => x.id === p.id ? { ...x, method: e.target.value as SplitMethod } : x))}
                      className="w-20 text-[11px] font-bold border-none bg-slate-50 rounded px-1 h-[28px] outline-none text-slate-700 focus:ring-1 focus:ring-blue-500 cursor-pointer"
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
                        onChange={(e) => setSplitPayments(curr => curr.map(x => x.id === p.id ? { ...x, reference: e.target.value } : x))}
                        className="flex-1 text-[11px] border border-slate-200 rounded px-1.5 h-[28px] outline-none focus:border-blue-500 w-16"
                      />
                    ) : (
                      <div className="flex-1 w-16"></div>
                    )}
                    
                    <input
                      type="number"
                      aria-label={`Payment ${i + 1} amount`}
                      placeholder="Amt"
                      value={p.amount ?? ''}
                      onChange={(e) => setSplitPayments(curr => curr.map(x => x.id === p.id ? { ...x, amount: e.target.value ? parseFloat(e.target.value) : null } : x))}
                      className="w-[72px] text-right text-[12px] font-bold border border-slate-200 rounded px-1.5 h-[28px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                    
                    {/*
                      "×" is a glyph, not a name. Marked aria-hidden with the name on the button,
                      so the control announces what it removes rather than announcing "times".
                    */}
                    <button
                      type="button"
                      aria-label={`Remove payment ${i + 1}`}
                      onClick={() => setSplitPayments(curr => curr.filter(x => x.id !== p.id))}
                      className="w-6 h-[28px] flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                ))}
                
                <button
                  type="button"
                  onClick={() => setSplitPayments(curr => [...curr, { id: Date.now().toString(), method: "CASH", amount: null, reference: "" }])}
                  className="w-full h-[30px] border border-dashed border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-[6px] text-[11px] font-semibold transition-colors shrink-0"
                >
                  + Add Payment Row
                </button>
                
                {/*
                  Reads the hoisted tally rather than recomputing it, so this number and the
                  Complete Sale button can never tell the cashier two different things.
                */}
                <div className="flex justify-between items-center text-[13px] h-[26px] mt-1 px-1 shrink-0">
                  <span className="font-semibold text-slate-500">
                    {splitRemainingMinor > 0 ? "Remaining" : "Balance"}
                  </span>
                  <span
                    data-testid="split-remaining"
                    className={`font-bold ${splitRemainingMinor > 0 ? "text-amber-600" : "text-slate-900"}`}
                  >
                    {splitRemainingMinor > 0
                      ? formatMinor(splitRemainingMinor)
                      : splitOverMinor > 0 && splitHasCash
                        ? formatMinor(splitOverMinor)
                        : "—"}
                  </span>
                </div>
             </div>
           )}

           {saleError && <p className="text-[12px] text-rose-600 font-medium mt-1">{saleError}</p>}

           <button 
             onClick={completeSale}
             id="complete-sale-btn"
             type="button"
             disabled={submitting || cart.length === 0 || splitBlocked}
             className="w-full h-[50px] bg-[#10b981] hover:bg-[#059669] text-white font-bold text-[14px] rounded-[8px] flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-3"
           >
             <Package className="w-5 h-5"/>
             {submitting ? "Completing..." : "Complete Sale"}
           </button>
        </div>
      </div>
    </div>
    </>
  );
}
function ActionBtn({ icon, label, hotkey, disabled = false }: { icon: React.ReactNode, label: string, hotkey?: string, disabled?: boolean }) {
  return (
    <button disabled={disabled} className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg border ${disabled ? 'border-slate-100 bg-slate-50 text-slate-400 opacity-60 cursor-not-allowed' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50'}`}>
       {icon}
       <span className="text-[11px] font-medium text-center leading-tight">
         {label}
         {hotkey && <span className="block text-[10px] text-slate-400 font-normal">{hotkey}</span>}
       </span>
    </button>
  );
}

function CustomerPicker(props: {
  customer: CustomerHit | null;
  onChange: (customer: CustomerHit | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [search, setSearch] = useState<SearchState<CustomerHit>>(EMPTY_SEARCH);
  const requestSeq = useRef(0);

  useEffect(() => {
    const current = term.trim();
    if (current.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearch(EMPTY_SEARCH);
      return;
    }
    const seq = ++requestSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/customers?q=${encodeURIComponent(current)}`);
        const data = await res.json();
        if (seq !== requestSeq.current) return;
        setSearch(
          res.ok
            ? { term: current, results: data.results as CustomerHit[], error: null }
            : { term: current, results: [], error: data?.error?.message ?? "Customer lookup failed." }
        );
      } catch {
        if (seq !== requestSeq.current) return;
        setSearch({ term: current, results: [], error: "Customer lookup failed." });
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [term]);

  const settled = search.term === term.trim();
  const hits = settled ? search.results : [];
  const searching = term.trim().length > 0 && !settled;

  async function createCustomer() {
    const name = newName.trim();
    if (name.length < 2) {
      setCreateError("Enter the customer's name.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const typed = term.trim();
      const res = await fetch("/api/v1/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          phone: /^[+0-9 ()-]+$/.test(typed) ? typed : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data?.error?.message ?? "Could not add the customer.");
        return;
      }
      props.onChange(data.customer as CustomerHit);
      setOpen(false);
      setTerm("");
      setNewName("");
    } catch {
      setCreateError("Could not add the customer.");
    } finally {
      setCreating(false);
    }
  }

  if (props.customer) {
    return (
      <div className="flex items-center gap-2.5">
        <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100 shadow-sm">
          <Users className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0 leading-tight">
          <p className="text-[12px] font-bold text-slate-900 truncate">{props.customer.name}</p>
          <p className="text-[10px] text-slate-500 mt-0.5 truncate">{props.customer.phone || 'No phone'}</p>
        </div>
        <button
          type="button"
          onClick={() => props.onChange(null)}
          className="px-3 h-[32px] text-[12px] font-semibold bg-slate-50 border border-slate-200/60 text-slate-600 rounded-[6px] hover:bg-slate-100 transition-colors"
        >
          Change
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2.5">
        <div className="w-10 h-10 rounded-full bg-slate-50 border border-slate-200 text-slate-400 flex items-center justify-center shrink-0 shadow-sm">
          <Users className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0 leading-tight">
          <p className="text-[12px] font-bold text-slate-800">Walk-in Customer</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Add customer for loyalty, khata or GST</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-3 h-[32px] text-[12px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/60 rounded-[6px] hover:bg-blue-100 transition-colors"
        >
          Add
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-[12px] font-semibold text-slate-700 uppercase tracking-wide">
          Select Customer
        </label>
        <button
          onClick={() => { setOpen(false); setCreateError(null); }}
          className="text-[11px] text-slate-500 hover:text-slate-800 underline"
        >
          Cancel
        </button>
      </div>
      <input
        autoFocus
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search name or phone..."
        className="w-full text-[13px] border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
      />
      {searching && <p className="text-[11px] text-slate-400">Searching...</p>}
      
      {hits.length > 0 && (
        <ul className="border border-slate-100 rounded-md divide-y divide-slate-100 max-h-32 overflow-y-auto">
          {hits.map(hit => (
            <li key={hit.id}>
              <button
                onClick={() => { props.onChange(hit); setOpen(false); setTerm(""); }}
                className="w-full text-left px-3 py-2 text-[13px] hover:bg-blue-50 transition-colors flex justify-between items-center"
              >
                <span className="font-medium text-slate-800">{hit.name}</span>
                {hit.phone && <span className="text-[11px] text-slate-500">{hit.phone}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {term.length > 0 && !searching && hits.length === 0 && (
        <div className="pt-2 border-t border-slate-100">
          <p className="text-[11px] text-slate-500 mb-1">Customer not found. Add new:</p>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Full Name"
              className="flex-1 text-[13px] border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
            />
            <button
              onClick={createCustomer}
              disabled={creating}
              className="px-3 py-2 bg-slate-900 text-white text-[13px] font-medium rounded-md hover:bg-slate-800 disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {createError && <p className="text-[12px] text-rose-600 mt-1">{createError}</p>}
        </div>
      )}
    </div>
  );
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
  const tenderedMinor = receipt
    ? receipt.payments.reduce((n, p) => n + p.amountMinor, 0)
    : sale.paidMinor;
  const changeMinor = tenderedMinor - totalMinor;

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
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-sm print:static print:block print:overflow-visible print:bg-transparent print:backdrop-blur-none"
      data-testid="sale-success"
    >
      <div className="flex min-h-full items-center justify-center p-4 print:block print:p-0">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-success-heading"
        tabIndex={-1}
        className="relative grid w-full max-w-4xl focus:outline-none animate-in fade-in zoom-in duration-200 overflow-hidden rounded-2xl bg-white shadow-2xl lg:grid-cols-2 print:block print:max-w-none print:animate-none print:rounded-none print:shadow-none"
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
        <div className="flex flex-col justify-center p-6 sm:p-8 print:hidden">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="h-8 w-8" />
          </div>

          <h2
            id="sale-success-heading"
            className="text-center text-2xl font-bold text-slate-900"
          >
            Sale Completed!
          </h2>
          <p className="mt-1 text-center text-[13px] text-slate-500">Bill generated successfully</p>

          {sale.duplicate && (
            <p className="mt-4 rounded-lg bg-amber-50 p-2 text-center text-[12px] text-amber-800">
              Duplicate submission. The original sale was retrieved — nothing was charged twice.
            </p>
          )}

          {/* Transaction summary */}
          <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-4">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Bill No.
              </dt>
              <dd
                className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-slate-900"
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
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Date &amp; Time
              </dt>
              <dd className="mt-0.5 text-[13px] font-semibold text-slate-900">
                {receipt ? formatDateTime(new Date(receipt.completedAt)) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Total
              </dt>
              <dd
                className="mt-0.5 text-[13px] font-semibold text-slate-900"
                data-testid="success-total"
              >
                {formatMinor(totalMinor)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Items
              </dt>
              <dd
                className="mt-0.5 text-[13px] font-semibold text-slate-900"
                data-testid="success-item-count"
              >
                {itemCount ?? "—"}
              </dd>
            </div>
          </dl>

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

          <div className="mt-6 flex flex-col gap-2">
            <button
              ref={printAction}
              type="button"
              onClick={printReceipt}
              disabled={!receipt}
              data-testid="success-print"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Printer className="h-4 w-4" />
              {receipt ? "Print Receipt" : "Preparing receipt..."}
            </button>

            <Link
              href={`/sales/${sale.id}`}
              data-testid="success-bill-details"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-3 font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600"
            >
              <FileText className="h-4 w-4" />
              View Bill Details
            </Link>

            <button
              type="button"
              onClick={props.onNewSale}
              data-testid="success-new-sale"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-3 font-semibold text-blue-700 transition-colors hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <Plus className="h-4 w-4" />
              New Sale
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
              ERP sync pending
            </p>
          )}
        </div>

        {/* ---------- Receipt ---------- */}
        <div
          id="sale-receipt"
          className="relative border-t border-slate-200 bg-slate-100 p-4 sm:p-6 lg:border-l lg:border-t-0 print:border-0 print:bg-white print:p-0"
        >
          {receipt ? (
            <div className="mx-auto max-w-[22rem] bg-white px-5 py-6 text-[12px] text-slate-700 shadow-sm print:max-w-none print:shadow-none">
              {/* Header — store identity. No GSTIN: AMBURAX has no store-level tax
                  registration field, and a tenant-wide taxId is not one. */}
              <div className="text-center">
                <p className="text-base font-bold tracking-tight text-slate-900">
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
                {changeMinor > 0 && (
                  <div className="mt-2 flex justify-between gap-3 border-t border-dashed border-slate-300 pt-2 font-semibold text-slate-900">
                    <span>Change</span>
                    <span data-testid="receipt-change">{formatMinor(changeMinor)}</span>
                  </div>
                )}
              </div>

              <p className="mt-4 text-center text-[10px] text-slate-500">
                {erpPending ? "ERP sync pending" : "ERP synced"}
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
