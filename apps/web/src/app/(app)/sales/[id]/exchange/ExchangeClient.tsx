"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Repeat,
  Package,
  Plus,
  Minus,
  Trash2,
  Search,
  CheckCircle2,
  CreditCard,
  Banknote,
  Smartphone,
  Loader2
} from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";

interface ReturnableItem {
  id: string;
  name: string;
  sku: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
  soldQuantity: number;
  alreadyReturned: number;
  returnableQuantity: number;
}

interface CatalogItem {
  variantId: string;
  productName: string;
  sku: string;
  priceMinor: number;
  stockQuantity: number | null;
}

export function ExchangeClient({
  saleId,
  billNumber,
  customerName,
  returnableLines,
}: {
  saleId: string;
  billNumber: string;
  customerName: string | null;
  returnableLines: ReturnableItem[];
}) {
  const router = useRouter();

  // Return quantities selected
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});

  // New replacement cart
  const [replacementCart, setReplacementCart] = useState<{ item: CatalogItem; quantity: number }[]>([]);

  // Search catalogue for replacements
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CatalogItem[]>([]);
  const [searching, setSearching] = useState(false);

  // Settlement
  const [method, setMethod] = useState<"CASH" | "UPI" | "CARD">("CASH");
  const [reason, setReason] = useState("Customer requested item exchange / size swap");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per exchange on this screen: a double tap or a retry after a timeout sends the same
  // key, so the server returns the first exchange instead of recording a second one.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [successExchange, setSuccessExchange] = useState<any | null>(null);

  // Search debounce
  useEffect(() => {
    const term = searchQuery.trim();
    if (!term) {
      const resetTimer = setTimeout(() => {
        setSearchResults([]);
      }, 0);
      return () => clearTimeout(resetTimer);
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/v1/catalog/search?q=${encodeURIComponent(term)}`);
        const data = await res.json();
        if (res.ok && data?.results) {
          setSearchResults(data.results);
        }
      } catch {
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Compute total return credit
  const returnCreditMinor = returnableLines.reduce((sum, line) => {
    const qty = returnQtys[line.id] ?? 0;
    if (qty <= 0 || line.soldQuantity <= 0) return sum;
    const itemRefund = Math.round(line.lineTotalMinor * (qty / line.soldQuantity));
    return sum + itemRefund;
  }, 0);

  // Compute new cart total
  const newCartTotalMinor = replacementCart.reduce((sum, line) => {
    return sum + line.item.priceMinor * line.quantity;
  }, 0);

  // Net difference
  const netDifferenceMinor = newCartTotalMinor - returnCreditMinor;

  const handleProcessExchange = async () => {
    setError(null);
    const returnItems = Object.entries(returnQtys)
      .filter(([_, q]) => q > 0)
      .map(([id, q]) => ({ originalSaleItemId: id, quantity: q }));

    if (returnItems.length === 0) {
      setError("Please select at least 1 item to return.");
      return;
    }

    if (replacementCart.length === 0) {
      setError("Please add at least 1 replacement item to the exchange cart.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/sales/${saleId}/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnItems,
          newLines: replacementCart.map((c) => ({ variantId: c.item.variantId, quantity: c.quantity })),
          settlement: { method },
          reason: reason.trim(),
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.message || "Exchange transaction failed.");
        return;
      }

      setSuccessExchange(data.exchange);
    } catch {
      setError("Network failure while submitting exchange.");
    } finally {
      setSubmitting(false);
    }
  };

  if (successExchange) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-emerald-200 bg-white p-8 shadow-xl space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/50">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Exchange Completed Successfully</h2>
          <p className="mt-1 text-xs text-slate-500 font-mono">Reference: {successExchange.exchangeId}</p>
        </div>

        <div className="grid grid-cols-3 gap-3 rounded-2xl bg-slate-50 p-4 text-left border border-slate-200/80">
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-500">Return Credit</p>
            <p className="text-sm font-bold font-mono text-slate-900 mt-0.5">{formatMinor(successExchange.returnCreditMinor)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-500">New Items Total</p>
            <p className="text-sm font-bold font-mono text-slate-900 mt-0.5">{formatMinor(successExchange.newSaleTotalMinor)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-500">Net Settled</p>
            <p className={`text-sm font-bold font-mono mt-0.5 ${successExchange.netDifferenceMinor > 0 ? "text-emerald-700" : successExchange.netDifferenceMinor < 0 ? "text-amber-700" : "text-slate-900"}`}>
              {successExchange.netDifferenceMinor > 0 ? `Paid +${formatMinor(successExchange.netDifferenceMinor)}` : successExchange.netDifferenceMinor < 0 ? `Refunded ${formatMinor(Math.abs(successExchange.netDifferenceMinor))}` : "Even (₹0)"}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            href={`/sales/${successExchange.newSale.id}`}
            className="amb-press rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-primary-active"
          >
            View New Bill
          </Link>
          <Link
            href={`/sales/${saleId}`}
            className="amb-press rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to Original Bill
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div className="flex items-center gap-3">
          <Link href={`/sales/${saleId}`} className="amb-press rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-black tracking-tight text-slate-900 flex items-center gap-2">
              <Repeat className="h-5 w-5 text-indigo-600" />
              Process Sale Exchange
            </h1>
            <p className="text-xs text-slate-500 font-medium">Original Invoice: #{billNumber} {customerName ? `· ${customerName}` : ""}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Returned Items Selection */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-rose-700 text-[10px]">1</span>
            Step 1: Select Items Coming Back
          </h2>

          <div className="space-y-3">
            {returnableLines.map((line) => {
              const qty = returnQtys[line.id] ?? 0;
              const disabled = line.returnableQuantity === 0;

              return (
                <div key={line.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3.5 border border-slate-200/60">
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="text-xs font-bold text-slate-900 truncate">{line.name}</p>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">{line.sku} · Returnable: {line.returnableQuantity} of {line.soldQuantity}</p>
                    <p className="text-xs font-mono font-bold text-slate-800 mt-1">{formatMinor(line.unitPriceMinor)}/pc</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={disabled || qty <= 0}
                      onClick={() => setReturnQtys((q) => ({ ...q, [line.id]: Math.max(0, qty - 1) }))}
                      className="h-8 w-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-7 text-center font-mono font-bold text-xs text-slate-900">{qty}</span>
                    <button
                      type="button"
                      disabled={disabled || qty >= line.returnableQuantity}
                      onClick={() => setReturnQtys((q) => ({ ...q, [line.id]: Math.min(line.returnableQuantity, qty + 1) }))}
                      className="h-8 w-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl bg-rose-50/70 border border-rose-100 p-3.5 flex items-center justify-between">
            <span className="text-xs font-bold text-rose-900">Total Return Credit:</span>
            <span className="text-base font-black font-mono text-rose-700">{formatMinor(returnCreditMinor)}</span>
          </div>
        </div>

        {/* Right Column: New Replacement Items */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-[10px]">2</span>
            Step 2: Add Replacement Items
          </h2>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search replacement product by name, SKU or barcode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-9 pr-3 text-xs text-slate-900 focus:bg-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Search Dropdown */}
          {searchResults.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg space-y-1">
              {searchResults.map((hit) => (
                <button
                  type="button"
                  key={hit.variantId}
                  onClick={() => {
                    setReplacementCart((cur) => {
                      const ex = cur.find((c) => c.item.variantId === hit.variantId);
                      if (ex) {
                        return cur.map((c) => (c.item.variantId === hit.variantId ? { ...c, quantity: c.quantity + 1 } : c));
                      }
                      return [...cur, { item: hit, quantity: 1 }];
                    });
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 text-left text-xs"
                >
                  <div className="min-w-0 pr-2">
                    <p className="font-bold text-slate-900 truncate">{hit.productName}</p>
                    <p className="text-[10px] text-slate-500 font-mono">{hit.sku}</p>
                  </div>
                  <span className="font-mono font-bold text-slate-800">{formatMinor(hit.priceMinor)}</span>
                </button>
              ))}
            </div>
          )}

          {/* Replacement Cart List */}
          <div className="space-y-2 min-h-[140px]">
            {replacementCart.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center border-2 border-dashed border-slate-200 rounded-xl">
                No replacement items selected yet. Search above to add items.
              </p>
            ) : (
              replacementCart.map((row) => (
                <div key={row.item.variantId} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 border border-slate-200/60">
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="text-xs font-bold text-slate-900 truncate">{row.item.productName}</p>
                    <p className="text-[11px] font-mono text-slate-500">{formatMinor(row.item.priceMinor)} each</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setReplacementCart((cur) =>
                          cur
                            .map((c) => (c.item.variantId === row.item.variantId ? { ...c, quantity: c.quantity - 1 } : c))
                            .filter((c) => c.quantity > 0)
                        )
                      }
                      className="h-7 w-7 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-700"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-6 text-center font-mono font-bold text-xs">{row.quantity}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setReplacementCart((cur) =>
                          cur.map((c) => (c.item.variantId === row.item.variantId ? { ...c, quantity: c.quantity + 1 } : c))
                        )
                      }
                      className="h-7 w-7 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-700"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="rounded-xl bg-indigo-50/70 border border-indigo-100 p-3.5 flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-900">New Items Total:</span>
            <span className="text-base font-black font-mono text-indigo-700">{formatMinor(newCartTotalMinor)}</span>
          </div>
        </div>
      </div>

      {/* Step 3: Net Settlement Summary & Confirmation */}
      <div className="rounded-3xl border-2 border-slate-900 bg-slate-950 p-6 text-white shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h3 className="text-base font-bold">Exchange Net Settlement</h3>
            <p className="text-xs text-slate-400">Calculates difference between returned credit and replacement goods</p>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-bold uppercase text-slate-400">Balance Calculation</span>
            <p className={`text-2xl font-black font-mono mt-0.5 ${netDifferenceMinor > 0 ? "text-emerald-400" : netDifferenceMinor < 0 ? "text-amber-400" : "text-white"}`}>
              {netDifferenceMinor > 0 ? `Customer Pays +${formatMinor(netDifferenceMinor)}` : netDifferenceMinor < 0 ? `Refund to Customer -${formatMinor(Math.abs(netDifferenceMinor))}` : "Even Exchange (₹0)"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">Settlement Tender:</span>
            <div className="flex gap-1.5">
              {(["CASH", "UPI", "CARD"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`rounded-lg px-3 py-1 text-xs font-bold transition-colors ${method === m ? "bg-white text-slate-950" : "bg-white/10 text-slate-300 hover:bg-white/20"}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs font-bold text-rose-400">{error}</p>}

          <button
            type="button"
            disabled={submitting || replacementCart.length === 0 || returnCreditMinor === 0}
            onClick={handleProcessExchange}
            className="amb-press inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-500 px-6 text-xs font-black text-slate-950 shadow-lg hover:bg-emerald-400 disabled:opacity-40"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Repeat className="h-4 w-4" />}
            Confirm &amp; Finalize Exchange
          </button>
        </div>
      </div>
    </div>
  );
}
