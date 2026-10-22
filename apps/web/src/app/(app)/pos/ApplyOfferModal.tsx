"use client";

import { useState } from "react";
import { X, Sparkles, Plus, CheckCircle2, Power, Trash2, ArrowRight } from "lucide-react";
import { type PromotionRule } from "@/server/promotions/promotionEngine";
import { useActivePromotions } from "@/server/promotions/promotionsStore";
import { formatMinor } from "@/server/sales/saleTotals";

export function ApplyOfferModal(props: {
  isOpen: boolean;
  onClose: () => void;
  cartTotalMinor: number;
  activePromos: string[];
  selectedOfferId?: string | null;
  onSelectOffer?: (id: string | null) => void;
  userRole?: string;
}) {
  const [promotions, setPromotions] = useActivePromotions();
  const [isCreating, setIsCreating] = useState(false);
  const [newOffer, setNewOffer] = useState<{
    name: string;
    type: PromotionRule["type"];
    minSpend: string;
    discountAmount: string;
    buyQty: string;
    getQty: string;
    packQty: string;
    packPrice: string;
  }>({
    name: "",
    type: "TIERED_SPEND",
    minSpend: "",
    discountAmount: "",
    buyQty: "2",
    getQty: "1",
    packQty: "3",
    packPrice: "",
  });

  if (!props.isOpen) return null;

  function togglePromotion(id: string) {
    const updated = promotions.map((p) => (p.id === id ? { ...p, active: !p.active } : p));
    setPromotions(updated);
    if (props.selectedOfferId === id) {
      props.onSelectOffer?.(null);
    }
  }

  function deletePromotion(id: string) {
    const updated = promotions.filter((p) => p.id !== id);
    setPromotions(updated);
    if (props.selectedOfferId === id) {
      props.onSelectOffer?.(null);
    }
  }

  function handleCreateOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!newOffer.name.trim()) return;

    let description = "";
    let minSpendMinor: number | undefined;
    let discountMinor: number | undefined;
    let buyQty: number | undefined;
    let getQty: number | undefined;
    let packQty: number | undefined;
    let packPriceMinor: number | undefined;

    if (newOffer.type === "TIERED_SPEND") {
      minSpendMinor = Math.round(parseFloat(newOffer.minSpend || "0") * 100);
      discountMinor = Math.round(parseFloat(newOffer.discountAmount || "0") * 100);
      description = `Spend ₹${newOffer.minSpend || 0} or more and get instant ₹${newOffer.discountAmount || 0} off bill.`;
    } else if (newOffer.type === "BOGO") {
      buyQty = parseInt(newOffer.buyQty, 10) || 2;
      getQty = parseInt(newOffer.getQty, 10) || 1;
      description = `Buy ${buyQty} items and get ${getQty} item(s) free automatically.`;
    } else if (newOffer.type === "PACK_DISCOUNT") {
      packQty = parseInt(newOffer.packQty, 10) || 3;
      packPriceMinor = Math.round(parseFloat(newOffer.packPrice || "0") * 100);
      description = `Buy any ${packQty} items for flat ₹${newOffer.packPrice || 0}.`;
    }

    const created: PromotionRule = {
      id: `promo-custom-${Date.now()}`,
      name: newOffer.name.trim(),
      type: newOffer.type,
      description,
      active: true, // Started and activated immediately
      minSpendMinor,
      discountMinor,
      buyQty,
      getQty,
      packQty,
      packPriceMinor,
    };

    setPromotions([created, ...promotions]);
    // Auto-select this offer for the current bill
    props.onSelectOffer?.(created.id);
    setIsCreating(false);
    setNewOffer({
      name: "",
      type: "TIERED_SPEND",
      minSpend: "",
      discountAmount: "",
      buyQty: "2",
      getQty: "1",
      packQty: "3",
      packPrice: "",
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-offer-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
    >
      <div className="amb-pop-in relative w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            <div>
              <div className="flex items-center gap-2">
                <h3 id="apply-offer-title" className="text-base font-bold text-slate-900">
                  Offers &amp; Counter Schemes (F6)
                </h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  Role: {props.userRole ?? "Staff"}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Only 1 offer applies per bill. Select which offer you want to apply:
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isCreating && (
              <button
                type="button"
                onClick={() => setIsCreating(true)}
                className="flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-brand-500 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Add Offer
              </button>
            )}
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {isCreating ? (
          <form onSubmit={handleCreateOffer} className="mt-4 space-y-3.5 rounded-xl border border-brand-200 bg-brand-50/20 p-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold text-slate-900">Create New Counter Offer</span>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700">Offer Title</label>
              <input
                required
                value={newOffer.name}
                onChange={(e) => setNewOffer((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Festival Flat ₹200 Off"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700">Scheme Type</label>
                <select
                  value={newOffer.type}
                  onChange={(e) => setNewOffer((prev) => ({ ...prev, type: e.target.value as PromotionRule["type"] }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="TIERED_SPEND">Cart Minimum Discount</option>
                  <option value="BOGO">Buy X Get Y Free</option>
                  <option value="PACK_DISCOUNT">Multi-Pack Special Price</option>
                </select>
              </div>

              {newOffer.type === "TIERED_SPEND" && (
                <>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700">Min Cart (₹)</label>
                    <input
                      type="number"
                      required
                      value={newOffer.minSpend}
                      onChange={(e) => setNewOffer((prev) => ({ ...prev, minSpend: e.target.value }))}
                      placeholder="e.g. 2000"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-brand-500 focus:outline-none"
                    />
                  </div>
                </>
              )}
            </div>

            {newOffer.type === "TIERED_SPEND" && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-700">Discount Amount (₹)</label>
                <input
                  type="number"
                  required
                  value={newOffer.discountAmount}
                  onChange={(e) => setNewOffer((prev) => ({ ...prev, discountAmount: e.target.value }))}
                  placeholder="e.g. 200"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-brand-500 focus:outline-none"
                />
              </div>
            )}

            {newOffer.type === "BOGO" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700">Buy Qty</label>
                  <input
                    type="number"
                    value={newOffer.buyQty}
                    onChange={(e) => setNewOffer((prev) => ({ ...prev, buyQty: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700">Get Free Qty</label>
                  <input
                    type="number"
                    value={newOffer.getQty}
                    onChange={(e) => setNewOffer((prev) => ({ ...prev, getQty: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
                  />
                </div>
              </div>
            )}

            {newOffer.type === "PACK_DISCOUNT" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700">Pack Qty</label>
                  <input
                    type="number"
                    value={newOffer.packQty}
                    onChange={(e) => setNewOffer((prev) => ({ ...prev, packQty: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700">Bundle Price (₹)</label>
                  <input
                    type="number"
                    value={newOffer.packPrice}
                    onChange={(e) => setNewOffer((prev) => ({ ...prev, packPrice: e.target.value }))}
                    placeholder="e.g. 999"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-500"
              >
                Save &amp; Start Offer
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
            {promotions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                No promotions created yet. Click &quot;Add Offer&quot; above to create your first counter discount!
              </div>
            ) : (
              promotions.map((promo: PromotionRule) => {
                const isQualifying =
                  promo.active &&
                  (promo.type === "TIERED_SPEND"
                    ? props.cartTotalMinor >= (promo.minSpendMinor ?? 0)
                    : true);

                const isApplied = props.activePromos.includes(promo.id);
                const isSelectedByUser = props.selectedOfferId === promo.id;

                return (
                  <div
                    key={promo.id}
                    className={`rounded-xl border p-3.5 transition-all ${
                      !promo.active
                        ? "border-slate-200 bg-slate-50/80 opacity-60"
                        : isApplied
                        ? "border-emerald-300 bg-emerald-50/50 ring-1 ring-emerald-500/20"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {/* Radio / Checkbox selection for single offer selection or clearing it */}
                        {promo.active && (
                          <button
                            type="button"
                            onClick={() => {
                              // If this offer is currently applied or selected, clicking it clears it (sets to 'none')
                              if (isApplied || isSelectedByUser) {
                                props.onSelectOffer?.("none");
                              } else {
                                props.onSelectOffer?.(promo.id);
                              }
                            }}
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all ${
                              isApplied || isSelectedByUser
                                ? "border-brand-600 bg-brand-600 text-white"
                                : "border-slate-300 hover:border-brand-500"
                            }`}
                            title={isApplied ? "Click to remove this offer from the bill" : "Click to apply this offer to the bill"}
                          >
                            {(isApplied || isSelectedByUser) && (
                              <span className="h-1.5 w-1.5 rounded-full bg-white" />
                            )}
                          </button>
                        )}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            promo.active ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {promo.type.replace("_", " ")}
                        </span>
                        <h4 className="text-xs font-bold text-slate-900">{promo.name}</h4>
                      </div>

                      <div className="flex items-center gap-2">
                        {promo.active ? (
                          isApplied ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Applied to Bill
                            </span>
                          ) : isQualifying ? (
                            <button
                              type="button"
                              onClick={() => props.onSelectOffer?.(promo.id)}
                              className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 underline"
                            >
                              Apply this offer
                            </button>
                          ) : (
                            <span className="text-[11px] font-medium text-slate-400">
                              Add items to qualify
                            </span>
                          )
                        ) : (
                          <span className="text-[11px] font-medium text-slate-400">
                            Stopped
                          </span>
                        )}

                        {/* Start / Stop Toggle Button */}
                        <button
                          type="button"
                          onClick={() => togglePromotion(promo.id)}
                          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                            promo.active
                              ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                              : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                          }`}
                          title={promo.active ? "Stop this offer" : "Start this offer"}
                        >
                          <Power className="h-3 w-3" />
                          {promo.active ? "Stop" : "Start"}
                        </button>

                        {/* Delete Button */}
                        <button
                          type="button"
                          onClick={() => deletePromotion(promo.id)}
                          className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                          title="Delete offer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="mt-1 text-xs text-slate-600 pl-6">{promo.description}</p>

                    {promo.type === "TIERED_SPEND" && promo.minSpendMinor && promo.discountMinor && (
                      <div className="mt-2 text-[11px] font-medium text-slate-500 pl-6">
                        Spend {formatMinor(promo.minSpendMinor)} → Get {formatMinor(promo.discountMinor)} off bill
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3">
          <div className="flex items-center gap-2">
            {props.selectedOfferId === "none" ? (
              <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
                No offer will apply to this bill (Udhar / Regular)
              </span>
            ) : (
              <span className="text-xs text-slate-500">
                Only 1 offer applies per bill
              </span>
            )}

            {props.selectedOfferId !== "none" && props.activePromos.length > 0 && (
              <button
                type="button"
                onClick={() => props.onSelectOffer?.("none")}
                className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 font-medium transition-colors"
                title="Remove discounts from this bill (e.g. for Udhar sales)"
              >
                Clear / Remove Offer
              </button>
            )}

            {props.selectedOfferId === "none" && (
              <button
                type="button"
                onClick={() => props.onSelectOffer?.(null)}
                className="text-xs text-brand-600 hover:underline font-medium"
              >
                (Re-enable automatic best offer)
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="amb-press rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
