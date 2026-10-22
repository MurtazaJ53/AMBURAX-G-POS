"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Tag, Sparkles, Plus, ToggleLeft, ToggleRight, CheckCircle2, Percent, Trash2 } from "lucide-react";
import { DEFAULT_PROMOTIONS, type PromotionRule } from "@/server/promotions/promotionEngine";
import { useActivePromotions } from "@/server/promotions/promotionsStore";

export function OffersManager() {
  const [rules, setRules] = useActivePromotions();
  const [filterType, setFilterType] = useState<string>("ALL");

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t);
  }, []);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newScheme, setNewScheme] = useState({
    name: "",
    type: "TIERED_SPEND" as PromotionRule["type"],
    description: "",
    minSpend: "",
    discountAmount: "",
    buyQty: "2",
    getQty: "1",
    packQty: "3",
    packPrice: "",
  });

  function toggleRule(id: string) {
    const updated = rules.map((r) => (r.id === id ? { ...r, active: !r.active } : r));
    setRules(updated);
  }

  function deleteRule(id: string) {
    const updated = rules.filter((r) => r.id !== id);
    setRules(updated);
  }

  function handleCreateScheme(e: React.FormEvent) {
    e.preventDefault();
    if (!newScheme.name.trim()) return;

    let description = newScheme.description;
    let minSpendMinor: number | undefined;
    let discountMinor: number | undefined;
    let buyQty: number | undefined;
    let getQty: number | undefined;
    let packQty: number | undefined;
    let packPriceMinor: number | undefined;

    if (newScheme.type === "TIERED_SPEND") {
      minSpendMinor = Math.round(parseFloat(newScheme.minSpend || "0") * 100);
      discountMinor = Math.round(parseFloat(newScheme.discountAmount || "0") * 100);
      if (!description) {
        description = `Spend ₹${newScheme.minSpend || 0} or more and get instant ₹${newScheme.discountAmount || 0} off at till.`;
      }
    } else if (newScheme.type === "BOGO") {
      buyQty = parseInt(newScheme.buyQty, 10) || 2;
      getQty = parseInt(newScheme.getQty, 10) || 1;
      if (!description) {
        description = `Buy ${buyQty} items and get ${getQty} item(s) free automatically.`;
      }
    } else if (newScheme.type === "PACK_DISCOUNT") {
      packQty = parseInt(newScheme.packQty, 10) || 3;
      packPriceMinor = Math.round(parseFloat(newScheme.packPrice || "0") * 100);
      if (!description) {
        description = `Buy any ${packQty} items for flat ₹${newScheme.packPrice || 0}.`;
      }
    }

    const created: PromotionRule = {
      id: `promo-custom-${Date.now()}`,
      name: newScheme.name,
      type: newScheme.type,
      description,
      active: true, // Created and activated immediately
      minSpendMinor,
      discountMinor,
      buyQty,
      getQty,
      packQty,
      packPriceMinor,
    };

    setRules([created, ...rules]);
    setIsCreateOpen(false);
    setNewScheme({
      name: "",
      type: "TIERED_SPEND",
      description: "",
      minSpend: "",
      discountAmount: "",
      buyQty: "2",
      getQty: "1",
      packQty: "3",
      packPrice: "",
    });
  }

  const filtered = filterType === "ALL" ? rules : rules.filter((r) => r.type === filterType);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Active Promotional Schemes & Bundles
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Automatic counter promotions: BOGO, volume discounts, and cart value tiers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Custom Offer
          </button>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 font-medium"
          >
            <option value="ALL">All Scheme Types</option>
            <option value="BOGO">BOGO (Buy X Get Y)</option>
            <option value="TIERED_SPEND">Tiered Cart Spend</option>
            <option value="PACK_DISCOUNT">Combo Pack Pricing</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((r) => (
          <div
            key={r.id}
            className={`rounded-2xl border p-5 transition-all shadow-sm flex flex-col justify-between ${
              r.active
                ? "border-emerald-200 bg-gradient-to-br from-white to-emerald-50/30 ring-1 ring-emerald-500/10"
                : "border-slate-200 bg-slate-50/50 opacity-75"
            }`}
          >
            <div>
              <div className="flex items-start justify-between gap-3">
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    r.type === "BOGO"
                      ? "bg-purple-100 text-purple-800"
                      : r.type === "TIERED_SPEND"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-blue-100 text-blue-800"
                  }`}
                >
                  <Tag className="h-3 w-3" />
                  {r.type.replace("_", " ")}
                </span>

                <button
                  type="button"
                  onClick={() => toggleRule(r.id)}
                  className="cursor-pointer text-slate-500 hover:text-slate-900"
                  title={r.active ? "Deactivate Scheme" : "Activate Scheme"}
                >
                  {r.active ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" /> Active
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-slate-400">Disabled</span>
                  )}
                </button>
              </div>

              <h3 className="mt-3 text-sm font-bold text-slate-900">{r.name}</h3>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">{r.description}</p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500 flex items-center justify-between">
              <span>Auto-applied in Till</span>
              <div className="flex items-center gap-1.5">
                {r.id.startsWith("promo-custom-") && (
                  <button
                    type="button"
                    onClick={() => deleteRule(r.id)}
                    className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    title="Delete Scheme"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggleRule(r.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    r.active
                      ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      : "bg-slate-900 text-white hover:bg-slate-800"
                  }`}
                >
                  {r.active ? "Pause" : "Enable in Till"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {mounted && isCreateOpen && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 amb-pop-in">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Tag className="h-4 w-4 text-emerald-600" />
                Create Custom Promotional Offer
              </h3>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateScheme} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Scheme Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Diwali Mega Cart Discount or Buy 3 Get 1"
                  value={newScheme.name}
                  onChange={(e) => setNewScheme({ ...newScheme, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Offer Type</label>
                <select
                  value={newScheme.type}
                  onChange={(e) =>
                    setNewScheme({
                      ...newScheme,
                      type: e.target.value as PromotionRule["type"],
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="TIERED_SPEND">Tiered Cart Spend (Spend ₹X get ₹Y off)</option>
                  <option value="BOGO">BOGO (Buy X Get Y Free)</option>
                  <option value="PACK_DISCOUNT">Combo Pack (Buy X items for flat ₹Y)</option>
                </select>
              </div>

              {newScheme.type === "TIERED_SPEND" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Min Cart Spend (₹)</label>
                    <input
                      type="number"
                      min="1"
                      required
                      placeholder="e.g. 5000"
                      value={newScheme.minSpend}
                      onChange={(e) => setNewScheme({ ...newScheme, minSpend: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Discount Amount (₹)</label>
                    <input
                      type="number"
                      min="1"
                      required
                      placeholder="e.g. 500"
                      value={newScheme.discountAmount}
                      onChange={(e) => setNewScheme({ ...newScheme, discountAmount: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {newScheme.type === "BOGO" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Buy Quantity</label>
                    <input
                      type="number"
                      min="1"
                      required
                      placeholder="e.g. 2"
                      value={newScheme.buyQty}
                      onChange={(e) => setNewScheme({ ...newScheme, buyQty: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Get Free Quantity</label>
                    <input
                      type="number"
                      min="1"
                      required
                      placeholder="e.g. 1"
                      value={newScheme.getQty}
                      onChange={(e) => setNewScheme({ ...newScheme, getQty: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {newScheme.type === "PACK_DISCOUNT" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Pack Quantity</label>
                    <input
                      type="number"
                      min="2"
                      required
                      placeholder="e.g. 3"
                      value={newScheme.packQty}
                      onChange={(e) => setNewScheme({ ...newScheme, packQty: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Fixed Pack Price (₹)</label>
                    <input
                      type="number"
                      min="1"
                      required
                      placeholder="e.g. 999"
                      value={newScheme.packPrice}
                      onChange={(e) => setNewScheme({ ...newScheme, packPrice: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700">Custom Description (Optional)</label>
                <input
                  type="text"
                  placeholder="Auto-generated if left empty"
                  value={newScheme.description}
                  onChange={(e) => setNewScheme({ ...newScheme, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 cursor-pointer"
                >
                  Save & Activate
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
