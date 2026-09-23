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
import { Search, Plus, Minus, Trash2, Package, LayoutGrid, CheckCircle2, SlidersHorizontal, Barcode, Zap, ChevronDown, AlignJustify, Shirt, Users, Tag } from "lucide-react";

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

type PaymentMethod = "CASH" | "UPI" | "CARD" | "SPLIT" | "MORE";

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
  
  const [submitting, setSubmitting] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompletedSale | null>(null);

  const idempotencyKey = useRef<string>("");
  if (idempotencyKey.current === "") {
    idempotencyKey.current = typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString();
  }
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

  function startNewSale() {
    setCart([]);
    setCustomer(null);
    setMethod("CASH");
    setReference("");
    setAmountReceived(null);
    setCompleted(null);
    setSaleError(null);
    setCartNotice(null);
    setQuery("");
    idempotencyKey.current = crypto.randomUUID();
    searchInput.current?.focus();
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

    try {
      const res = await fetch("/api/v1/sales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey.current,
          lines: cart.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
          customerId: customer?.id ?? null,
          payment: { method: method === "SPLIT" || method === "MORE" ? "CASH" : method, reference: reference.trim() ? reference.trim() : undefined }, // Fallback split/more to cash as placeholder
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
    } catch {
      setSaleError("We couldn't reach the server. Check the connection and press Complete sale again - this will not charge twice.");
    } finally {
      setSubmitting(false);
    }
  }

  if (completed) {
    return (
      <div className="absolute inset-0 bg-slate-50/90 z-50 flex items-center justify-center p-4">
        <SaleSuccess sale={completed} customerName={customer?.name ?? null} onNewSale={startNewSale} />
      </div>
    );
  }

  return (
    <div className="flex w-full h-[calc(100vh-68px)] overflow-hidden bg-slate-50 flex-col lg:flex-row">
      {/* Left Workspace (Products) - 70% */}
      <div className="flex-1 flex flex-col min-w-0 bg-white border-r border-slate-200">
        
        {/* Top Tabs */}
        <div className="flex px-4 pt-4 border-b border-slate-200 gap-6 text-sm font-medium">
          <button className="pb-3 border-b-2 border-blue-600 text-blue-600">Products</button>
          <button className="pb-3 border-b-2 border-transparent text-slate-500 hover:text-slate-700">Barcode Scan</button>
          <button className="pb-3 border-b-2 border-transparent text-slate-500 hover:text-slate-700">Quick Add</button>
        </div>

        {/* Filter Toolbar */}
        <div className="p-4 flex flex-col gap-3 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              ref={searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products by name, SKU, barcode..."
              className="w-full pl-9 pr-10 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
            <button className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <Barcode className="w-4 h-4" />
            </button>
          </div>
          
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
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
        <div className="px-4 py-3 flex gap-3 overflow-x-auto border-b border-slate-100 no-scrollbar">
           {['Men\'s Wear', 'Women\'s Wear', 'Kids Wear', 'Ethnic Wear', 'Footwear', 'Accessories', 'Innerwear'].map(cat => (
             <div key={cat} className="flex flex-col items-center gap-1.5 min-w-[72px] cursor-pointer group">
                <div className="w-12 h-12 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 group-hover:border-blue-200 group-hover:bg-blue-50">
                  <Shirt className="w-5 h-5"/>
                </div>
                <span className="text-[11px] font-medium text-slate-600 text-center">{cat}</span>
             </div>
           ))}
        </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50">
           {searchError && <p className="text-sm text-rose-600 bg-rose-50 p-3 rounded-lg border border-rose-100">{searchError}</p>}
           
           <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-4">
             {results.map(hit => (
               <button 
                 key={hit.variantId} 
                 onClick={() => addToCart(hit)}
                 className="flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow text-left group"
               >
                 <div className="aspect-[4/5] bg-slate-100 relative w-full border-b border-slate-100 flex items-center justify-center">
                    {hit.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={hit.imageUrl} alt={hit.productName} className="w-full h-full object-cover" />
                    ) : (
                      <Package className="w-8 h-8 text-slate-300" />
                    )}
                 </div>
                 <div className="p-3 flex flex-col gap-1.5">
                   <p className="text-sm font-medium text-slate-900 line-clamp-2 leading-snug">{hit.productName}</p>
                   <div className="flex justify-between items-end mt-1">
                     <div>
                       <p className="text-lg font-bold text-slate-900 leading-none">{formatMinor(hit.priceMinor)}</p>
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
          <p className="text-xs font-semibold text-slate-800 mb-3">Quick Actions</p>
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

      {/* Right Checkout Panel - 30% */}
      <div className="w-full lg:w-[400px] xl:w-[440px] flex flex-col bg-slate-50/50 lg:border-l border-slate-200 flex-shrink-0 h-[50vh] lg:h-full overflow-hidden">
        {/* Cart Tabs */}
        <div className="flex px-4 pt-4 border-b border-slate-200 gap-6 text-sm font-medium bg-white">
          <button className="pb-3 border-b-2 border-blue-600 text-blue-600">Cart ({cart.reduce((a,b)=>a+b.quantity, 0)})</button>
          <button className="pb-3 border-b-2 border-transparent text-slate-500 hover:text-slate-700">Customer</button>
        </div>

        {/* Customer Block */}
        <div className="p-4 bg-white border-b border-slate-200 shadow-sm z-10">
          <CustomerPicker customer={customer} onChange={setCustomer} />
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {cartNotice && (
             <p className="text-xs text-rose-700 bg-rose-50 p-2 rounded">{cartNotice}</p>
          )}
          {cart.map((line) => (
             <div key={line.variantId} className="flex gap-3 bg-white p-3 rounded-lg border border-slate-200 shadow-sm relative group">
                <div className="w-14 h-16 bg-slate-50 rounded border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                   {line.imageUrl ? (
                     /* eslint-disable-next-line @next/next/no-img-element */
                     <img src={line.imageUrl} alt={line.productName} className="w-full h-full object-cover" />
                   ) : (
                     <Package className="w-5 h-5 text-slate-300" />
                   )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                   <div className="pr-6">
                     <p className="text-[13px] font-medium text-slate-900 leading-snug truncate">{line.productName}</p>
                     <p className="text-[11px] text-slate-500 mt-0.5 truncate">{line.sku} {variantLabel(line) ? `| ${variantLabel(line)}` : ''}</p>
                   </div>
                   <div className="flex items-center justify-between mt-2">
                     <p className="text-sm font-bold text-slate-900">{formatMinor(line.unitPriceMinor)}</p>
                     
                     <div className="flex items-center border border-slate-200 rounded-md bg-slate-50/50">
                        <button onClick={() => setQuantity(line.variantId, line.quantity - 1)} className="w-7 h-7 flex items-center justify-center text-blue-600 hover:bg-slate-100 rounded-l-md"><Minus className="w-3.5 h-3.5"/></button>
                        <span className="w-8 text-center text-[13px] font-medium text-slate-900">{line.quantity}</span>
                        <button onClick={() => setQuantity(line.variantId, line.quantity + 1)} className="w-7 h-7 flex items-center justify-center text-blue-600 hover:bg-slate-100 rounded-r-md"><Plus className="w-3.5 h-3.5"/></button>
                     </div>
                   </div>
                </div>
                <button onClick={() => setQuantity(line.variantId, 0)} className="absolute top-3 right-3 text-slate-300 hover:text-rose-500">
                  <Trash2 className="w-4 h-4"/>
                </button>
             </div>
          ))}
          {cart.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-10">
               <Package className="w-12 h-12 mb-3 text-slate-300 opacity-50" />
               <p className="text-sm">Cart is empty</p>
            </div>
          )}
        </div>

        {/* Totals & Payment */}
        <div className="bg-white border-t border-slate-200 p-4 pb-6 flex flex-col gap-4 shadow-[0_-4px_10px_rgba(0,0,0,0.02)] z-10">
           {/* Add Discount Input (Visual shell for reference match) */}
           <div className="flex gap-2">
             <input disabled placeholder="Add Discount" className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-slate-500 cursor-not-allowed" />
             <div className="flex border border-slate-200 rounded-lg overflow-hidden opacity-50">
               <button disabled className="px-3 py-2 bg-slate-50 border-r border-slate-200 text-sm font-medium text-slate-600">%</button>
               <button disabled className="px-3 py-2 bg-white text-sm font-medium text-slate-600">₹</button>
             </div>
             <button disabled className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm font-medium text-slate-400">Apply</button>
           </div>

           {/* Totals Table */}
           <div className="flex flex-col gap-2 text-[13px]">
              <div className="flex justify-between text-slate-600">
                <span>Items ({cart.reduce((a,b)=>a+b.quantity,0)})</span>
                <span className="font-medium text-slate-900">{formatMinor(totals.subtotalMinor)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Discount</span>
                <span className="text-emerald-600">-{formatMinor(totals.discountMinor)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-medium text-slate-900">{formatMinor(totals.subtotalMinor - totals.discountMinor)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>GST (Tax)</span>
                <span className="font-medium text-slate-900">{formatMinor(totals.taxMinor)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-blue-700 mt-1 pt-2 border-t border-slate-100">
                <span>Total Amount</span>
                <span>{formatMinor(totals.totalMinor)}</span>
              </div>
           </div>

           {/* Payment Modes */}
           <div>
             <p className="text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wider">Payment Mode</p>
             <div className="flex gap-1.5">
               {PAYMENT_METHODS.map(m => (
                 <button 
                   key={m.value}
                   onClick={() => setMethod(m.value)}
                   className={`flex-1 py-2 px-1 text-[12px] font-medium rounded border ${method === m.value ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                 >
                   {m.label}
                 </button>
               ))}
             </div>
           </div>

           {/* Cash Amount Received */}
           {method === 'CASH' && (
             <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-slate-700">Amount Received</span>
                  <input 
                    type="number"
                    value={amountReceived ?? ''}
                    onChange={(e) => setAmountReceived(e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder={formatMinor(totals.totalMinor)}
                    className="w-32 text-right text-sm font-bold border border-slate-200 rounded-md px-3 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setAmountReceived((totals.totalMinor/100) + 1)} className="flex-1 text-xs border border-blue-200 text-blue-600 bg-blue-50 rounded py-1.5 font-medium">+1</button>
                  <button onClick={() => setAmountReceived((totals.totalMinor/100) + 10)} className="flex-1 text-xs border border-blue-200 text-blue-600 bg-blue-50 rounded py-1.5 font-medium">+10</button>
                  <button onClick={() => setAmountReceived((totals.totalMinor/100) + 100)} className="flex-1 text-xs border border-blue-200 text-blue-600 bg-blue-50 rounded py-1.5 font-medium">+100</button>
                  <button onClick={() => setAmountReceived(totals.totalMinor/100)} className="flex-[1.5] text-xs border border-blue-200 text-blue-700 bg-blue-100 rounded py-1.5 font-bold">Exact</button>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500">Balance</span>
                  <span className="font-bold text-slate-900">
                    {amountReceived && amountReceived * 100 >= totals.totalMinor 
                      ? formatMinor(Math.round(amountReceived * 100) - totals.totalMinor) 
                      : "₹0"}
                  </span>
                </div>
             </div>
           )}

           {saleError && <p className="text-xs text-rose-600">{saleError}</p>}

           <button 
             onClick={completeSale}
             disabled={submitting || cart.length === 0}
             className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-base py-3.5 rounded-lg flex items-center justify-center gap-2 shadow-sm shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed mt-1 transition-colors"
           >
             <Package className="w-5 h-5"/>
             {submitting ? "Completing..." : "Complete Sale (F8)"}
           </button>
        </div>
      </div>
    </div>
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
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <Users className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{props.customer.name}</p>
          <p className="text-xs text-slate-500 truncate">{props.customer.phone || 'No phone'}</p>
        </div>
        <button
          type="button"
          onClick={() => props.onChange(null)}
          className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded hover:bg-slate-200 transition-colors"
        >
          Change
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-slate-50 border border-slate-200 text-slate-400 flex items-center justify-center shrink-0">
          <Users className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800">Walk-in Customer</p>
          <p className="text-[11px] text-slate-500">Add customer for loyalty, khata or GST</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
        >
          Add
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
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
        className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
      />
      {searching && <p className="text-[11px] text-slate-400">Searching...</p>}
      
      {hits.length > 0 && (
        <ul className="border border-slate-100 rounded-md divide-y divide-slate-100 max-h-32 overflow-y-auto">
          {hits.map(hit => (
            <li key={hit.id}>
              <button
                onClick={() => { props.onChange(hit); setOpen(false); setTerm(""); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors flex justify-between items-center"
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
              className="flex-1 text-sm border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
            />
            <button
              onClick={createCustomer}
              disabled={creating}
              className="px-3 py-2 bg-slate-900 text-white text-sm font-medium rounded-md hover:bg-slate-800 disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {createError && <p className="text-xs text-rose-600 mt-1">{createError}</p>}
        </div>
      )}
    </div>
  );
}

function SaleSuccess(props: {
  sale: CompletedSale;
  customerName: string | null;
  onNewSale: () => void;
}) {
  return (
    <div className="w-full max-w-sm bg-white rounded-2xl p-8 text-center shadow-xl border border-slate-100 animate-in fade-in zoom-in duration-200">
      <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 mb-4">
        <CheckCircle2 className="w-8 h-8" />
      </div>
      <h2 className="text-xl font-bold text-slate-900">Payment Successful</h2>
      <p className="text-4xl font-extrabold tracking-tight text-slate-900 my-4">
        {formatMinor(props.sale.totalMinor)}
      </p>
      
      <div className="text-sm text-slate-500 bg-slate-50 rounded-lg p-3 mb-6 space-y-1">
        <p>Bill <span className="font-semibold text-slate-700">{props.sale.billNumber}</span></p>
        {props.customerName && <p>Customer: <span className="font-semibold text-slate-700">{props.customerName}</span></p>}
      </div>

      {props.sale.duplicate && (
        <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded mb-4">
          Duplicate submission. Original sale retrieved.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <button
          onClick={props.onNewSale}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg transition-colors"
        >
          Start New Sale
        </button>
        <Link
          href={`/sales/${props.sale.id}`}
          className="w-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-3 rounded-lg transition-colors inline-block"
        >
          View Receipt
        </Link>
      </div>
    </div>
  );
}
