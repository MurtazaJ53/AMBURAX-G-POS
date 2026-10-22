"use client";

import { useActionState, useState, useRef, useEffect, useMemo } from "react";
import {
  Trash2,
  AlertCircle,
  Barcode,
  Printer,
  ChevronDown,
  ChevronUp,
  Percent,
  Truck,
  Sparkles,
  Layers,
  ArrowRight,
  Maximize2,
  FileText,
  X,
  ExternalLink,
  Info,
  RotateCcw,
} from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { buttonClass, Card, CardHeader } from "../_components/ui";
import { savePurchaseAction, type PurchaseActionState } from "./actions";
import { PurchaseItemPicker, type PickedLine } from "./PurchaseItemPicker";
import { BillReader } from "./BillReader";
import type { BillDraft, DraftLine } from "@/server/purchasing/billScan";
import { BarcodeLabelModal, type PrintableVariantItem } from "../products/[id]/BarcodeLabelModal";
import { useFormDraft } from "@/client/hooks/useFormDraft";

const IDLE: PurchaseActionState = { status: "idle" };
const GST_RATES = [0, 500, 1200, 1800, 2800];

const INPUT =
  "amb-focus block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-2xs transition-all";

export interface PurchaseMatrixRow {
  variantId: string;
  sku: string;
  barcode: string | null;
  productName: string;
  size: string | null;
  colour: string | null;
  variantLabel: string;
  stock: number | null;
  quantity: string;
  cost: string; // Unit cost excl. GST
  gstRateBp: number;
  currentPriceMinor: number;
  currentMrpMinor: number | null;
  newPrice: string;
  newMrp: string;
  updatePrice: boolean;
  pricePolicy: "now" | "after_older_stock";
  /** If imported from a scanned bill */
  check?: string;
  originalBillText?: string;
}

type Override = { costMinor: number | null; gstRateBp: number; billText: string };

function rupees(minor: number | null): string {
  return minor === null ? "" : (minor / 100).toFixed(minor % 100 === 0 ? 0 : 2);
}

function toMinor(raw: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.replaceAll(",", "").trim());
  if (!m) return Number.NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

export function NewPurchaseForm({
  suppliers,
  canCreateProducts = false,
}: {
  suppliers: { id: string; name: string }[];
  canCreateProducts?: boolean;
}) {
  const [state, formAction, pending] = useActionState(savePurchaseAction, IDLE);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  // Automatic Offline & Refresh Draft Persistence
  const [draft, setDraft, resetDraft, hasRestoredDraft] = useFormDraft("gpos_purchase_draft", {
    supplierId: "",
    invoiceNo: "",
    invoiceDate: "",
    discountType: "fixed" as "fixed" | "percent",
    discountValue: "",
    freightCharges: "",
    rows: [] as PurchaseMatrixRow[],
    notes: "",
  });

  const supplierId = draft.supplierId;
  const setSupplierId = (val: string) => setDraft((p) => ({ ...p, supplierId: val }));

  const invoiceNo = draft.invoiceNo;
  const setInvoiceNo = (val: string) => setDraft((p) => ({ ...p, invoiceNo: val }));

  const invoiceDate = draft.invoiceDate;
  const setInvoiceDate = (val: string) => setDraft((p) => ({ ...p, invoiceDate: val }));

  const discountType = draft.discountType;
  const setDiscountType = (val: "fixed" | "percent") => setDraft((p) => ({ ...p, discountType: val }));

  const discountValue = draft.discountValue;
  const setDiscountValue = (val: string) => setDraft((p) => ({ ...p, discountValue: val }));

  const freightCharges = draft.freightCharges;
  const setFreightCharges = (val: string) => setDraft((p) => ({ ...p, freightCharges: val }));

  const rows = draft.rows;
  const setRows = (updater: PurchaseMatrixRow[] | ((prev: PurchaseMatrixRow[]) => PurchaseMatrixRow[])) => {
    setDraft((p) => ({
      ...p,
      rows: typeof updater === "function" ? updater(p.rows) : updater,
    }));
  };

  const notes = draft.notes;
  const setNotes = (val: string) => setDraft((p) => ({ ...p, notes: val }));

  // Items State
  const [unmatched, setUnmatched] = useState<DraftLine[]>([]);
  const [resolving, setResolving] = useState<number | null>(null);
  const [billNote, setBillNote] = useState<{ supplier: string | null; totalMinor: number | null } | null>(null);

  // Side-by-Side Bill Preview Drawer
  const [billPreview, setBillPreview] = useState<{ name: string; url: string; isPdf: boolean } | null>(null);
  const [showBillDrawer, setShowBillDrawer] = useState(false);

  // Barcode Print Modal
  const [barcodeModalOpen, setBarcodeModalOpen] = useState(false);

  // Ratio / Set Fill Modal state
  const [ratioModalGroupKey, setRatioModalGroupKey] = useState<string | null>(null);
  const [ratioQtyInput, setRatioQtyInput] = useState<string>("1");
  const [acknowledgedSimilar, setAcknowledgedSimilar] = useState(false);
  const [similarBillWarning, setSimilarBillWarning] = useState<{ message: string; receiptId?: string } | null>(null);

  const rowQtyRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const lastAddedVariantId = useRef<string | null>(null);

  useEffect(() => {
    if (lastAddedVariantId.current) {
      const input = rowQtyRefs.current.get(lastAddedVariantId.current);
      if (input) {
        input.focus();
        input.select();
      }
      lastAddedVariantId.current = null;
    }
  }, [rows]);

  function addPicked(lines: PickedLine[], override?: Override, check?: string) {
    if (lines.length > 0) {
      lastAddedVariantId.current = lines[0]!.variant.variantId;
    }
    setRows((rs) => {
      const next = [...rs];
      for (const l of lines) {
        const i = next.findIndex((r) => r.variantId === l.variant.variantId);
        if (i >= 0) {
          next[i] = {
            ...next[i]!,
            quantity: String((Number(next[i]!.quantity) || 0) + l.quantity),
            check: check ?? next[i]!.check,
            originalBillText: override?.billText ?? next[i]!.originalBillText,
          };
        } else {
          const gst = override ? override.gstRateBp : (l.variant.lastGstRateBp ?? l.variant.productGstRateBp ?? 500);
          const initialCostMinor = override?.costMinor ?? l.variant.lastCostMinor ?? l.variant.costPriceMinor ?? null;
          next.push({
            variantId: l.variant.variantId,
            sku: l.variant.sku,
            barcode: l.variant.barcode,
            productName: l.productName,
            size: l.variant.size,
            colour: l.variant.colour,
            variantLabel: [l.variant.size, l.variant.colour].filter(Boolean).join(" · ") || "Standard",
            stock: l.variant.stock,
            quantity: String(l.quantity),
            cost: rupees(initialCostMinor),
            gstRateBp: GST_RATES.includes(gst) ? gst : 500,
            currentPriceMinor: l.variant.priceMinor,
            currentMrpMinor: l.variant.mrpMinor ?? null,
            newPrice: rupees(l.variant.priceMinor),
            newMrp: rupees(l.variant.mrpMinor ?? null),
            updatePrice: false,
            pricePolicy: "after_older_stock",
            check,
            originalBillText: override?.billText,
          });
        }
      }
      return next;
    });
  }

  function applyDraft(d: BillDraft) {
    if (d.supplier) setSupplierId(d.supplier.id);
    if (d.invoiceNumber) setInvoiceNo(d.invoiceNumber);
    if (d.invoiceDate) setInvoiceDate(d.invoiceDate);
    setBillNote({
      supplier: d.supplier ? null : [d.supplierRead.name, d.supplierRead.gstin].filter(Boolean).join(" · ") || null,
      totalMinor: d.grandTotalMinor,
    });

    // Run duplicate pre-check immediately after AI reads the bill
    if (d.supplier?.id && d.invoiceNumber) {
      const q = new URLSearchParams({
        supplierId: d.supplier.id,
        invoiceNo: d.invoiceNumber,
        ...(d.invoiceDate ? { invoiceDate: d.invoiceDate } : {}),
      });
      fetch(`/api/v1/purchases/check-duplicate-bill?${q.toString()}`)
        .then((r) => r.json())
        .then((check) => {
          if (check.status === "duplicate" || check.status === "similar") {
            setSimilarBillWarning({
              message: check.message,
              receiptId: check.receiptId,
            });
          }
        })
        .catch(() => {});
    }

    for (const l of d.lines) {
      if (l.variant && l.productName) {
        addPicked(
          [{ variant: l.variant, productName: l.productName, quantity: l.quantity }],
          { costMinor: l.unitCostMinor, gstRateBp: l.gstRateBp, billText: l.billText },
          l.match === "suggested" ? "Matched by name — verify size/rate" : undefined,
        );
      }
    }
    setUnmatched(d.lines.filter((l) => !l.variant));
  }

  async function resolveUnmatched(lineIndex: number, lines: PickedLine[]) {
    const draft = unmatched[lineIndex];
    if (!draft) return;

    addPicked(
      lines,
      { costMinor: draft.unitCostMinor, gstRateBp: draft.gstRateBp, billText: draft.billText },
      undefined,
    );

    // Edge Case 4: Auto-learn supplier style alias if supplier is chosen
    if (supplierId && lines[0]?.variant?.variantId && draft.billText) {
      try {
        await fetch("/api/v1/purchasing/save-alias", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierId,
            billText: draft.billText,
            variantId: lines[0].variant.variantId,
          }),
        });
      } catch {
        // Non-blocking background alias save
      }
    }

    setUnmatched((u) => u.filter((_, i) => i !== lineIndex));
    setResolving(null);
  }

  function updateRow(variantId: string, patch: Partial<PurchaseMatrixRow>) {
    setRows((rs) => rs.map((r) => (r.variantId === variantId ? { ...r, ...patch } : r)));
  }

  // Group rows by Product + Colour to create an Expandable Style Matrix
  const groupedStyles = useMemo(() => {
    const groups: {
      key: string;
      productName: string;
      colour: string | null;
      items: PurchaseMatrixRow[];
    }[] = [];

    for (const r of rows) {
      const key = `${r.productName}___${r.colour ?? "standard"}`;
      let group = groups.find((g) => g.key === key);
      if (!group) {
        group = {
          key,
          productName: r.productName,
          colour: r.colour,
          items: [],
        };
        groups.push(group);
      }
      group.items.push(r);
    }
    return groups;
  }, [rows]);

  // Bulk Apply Rate/GST to an entire Style Group
  function applyRateToGroup(groupKey: string, costStr: string, gstRateBp: number) {
    const target = groupedStyles.find((g) => g.key === groupKey);
    if (!target) return;
    const vIds = new Set(target.items.map((i) => i.variantId));
    setRows((rs) =>
      rs.map((r) => (vIds.has(r.variantId) ? { ...r, cost: costStr, gstRateBp } : r))
    );
  }

  // Edge Case 2: Quick Ratio / Set Fill for a style group
  function applyRatioFill(groupKey: string, qtyPerSize: number) {
    const target = groupedStyles.find((g) => g.key === groupKey);
    if (!target) return;
    const vIds = new Set(target.items.map((i) => i.variantId));
    setRows((rs) =>
      rs.map((r) =>
        vIds.has(r.variantId) ? { ...r, quantity: String(qtyPerSize) } : r
      )
    );
    setRatioModalGroupKey(null);
  }

  // Edge Case 3: Landed Cost & Proration Calculation
  const discountMinor = useMemo(() => {
    if (!discountValue) return 0;
    const val = toMinor(discountValue);
    if (Number.isNaN(val) || val <= 0) return 0;
    return val;
  }, [discountValue]);

  const freightMinor = useMemo(() => {
    if (!freightCharges) return 0;
    const val = toMinor(freightCharges);
    if (Number.isNaN(val) || val <= 0) return 0;
    return val;
  }, [freightCharges]);

  // Preliminary row totals
  const preliminaryPriced = useMemo(() => {
    return rows.map((r) => {
      const qty = Number(r.quantity);
      const rawCostMinor = toMinor(r.cost);
      const priceMinor = r.updatePrice ? toMinor(r.newPrice) : null;
      const mrpMinor = r.updatePrice && r.newMrp ? toMinor(r.newMrp) : null;
      const ok =
        Number.isInteger(qty) &&
        qty > 0 &&
        !Number.isNaN(rawCostMinor) &&
        rawCostMinor >= 0 &&
        (!r.updatePrice || (!Number.isNaN(priceMinor) && priceMinor! >= 0));
      const taxable = ok ? qty * rawCostMinor : 0;
      return { ...r, qty, rawCostMinor, priceMinor, mrpMinor, taxable, ok };
    });
  }, [rows]);

  const baseTaxableSum = preliminaryPriced.reduce((s, r) => s + (r.ok ? r.taxable : 0), 0);
  const totalPieces = preliminaryPriced.reduce((s, r) => s + (r.ok ? r.qty : 0), 0);

  // Compute prorated net unit cost (discounts prorated by value, freight prorated by pieces or value)
  const priced = useMemo(() => {
    const actualDiscountMinor =
      discountType === "percent"
        ? Math.round((baseTaxableSum * (Number(discountValue) || 0)) / 100)
        : discountMinor;

    return preliminaryPriced.map((r) => {
      if (!r.ok || r.qty <= 0) {
        return {
          ...r,
          effectiveUnitCostMinor: r.rawCostMinor,
          taxable: 0,
          tax: 0,
          finalLineTotal: 0,
        };
      }

      // Value-weighted discount allocation
      const lineDiscount =
        baseTaxableSum > 0 ? Math.round((r.taxable / baseTaxableSum) * actualDiscountMinor) : 0;
      // Piece-weighted freight allocation
      const lineFreight =
        totalPieces > 0 ? Math.round((r.qty / totalPieces) * freightMinor) : 0;

      const effectiveTaxable = Math.max(0, r.taxable - lineDiscount + lineFreight);
      const effectiveUnitCostMinor = Math.round(effectiveTaxable / r.qty);
      const tax = Math.round((effectiveTaxable * r.gstRateBp) / 10000);
      const finalLineTotal = effectiveTaxable + tax;

      return {
        ...r,
        effectiveUnitCostMinor,
        taxable: effectiveTaxable,
        tax,
        finalLineTotal,
      };
    });
  }, [preliminaryPriced, discountType, discountValue, discountMinor, freightMinor, baseTaxableSum, totalPieces]);

  const totalTaxable = priced.reduce((s, r) => s + (r.ok ? r.taxable : 0), 0);
  const totalTax = priced.reduce((s, r) => s + (r.ok ? r.tax : 0), 0);
  const grandTotal = totalTaxable + totalTax;

  // JSON payload sending the prorated effectiveUnitCostMinor directly into stock ledger and variant updates
  const linesJson = useMemo(() => {
    return JSON.stringify(
      priced.map((r) => ({
        sku: r.sku.trim(),
        quantity: r.qty,
        unitCostMinor: r.effectiveUnitCostMinor,
        gstRateBp: r.gstRateBp,
        priceMinor: r.priceMinor,
        mrpMinor: r.mrpMinor,
        updatePrice: r.updatePrice,
        pricePolicy: r.pricePolicy,
      }))
    );
  }, [priced]);

  // Printable Barcode items
  const printablePurchaseItems: PrintableVariantItem[] = useMemo(() => {
    return priced
      .filter((r) => r.ok && r.qty > 0)
      .map((r) => ({
        id: r.variantId,
        sku: r.sku,
        barcode: r.barcode,
        productName: r.productName,
        size: r.size,
        colour: r.colour,
        priceMinor: r.updatePrice && r.priceMinor ? r.priceMinor : r.currentPriceMinor,
        mrpMinor: r.updatePrice && r.mrpMinor ? r.mrpMinor : r.currentMrpMinor,
        quantity: r.qty,
      }));
  }, [priced]);

  return (
    <>
      <form action={formAction} className="space-y-6" noValidate>
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="lines" value={linesJson} />
        <input type="hidden" name="acknowledgeSimilarBill" value={acknowledgedSimilar ? "true" : "false"} />

        {state.status === "error" && (
          <div role="alert" className="amb-pop-in flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-800 shadow-2xs">
            <AlertCircle className="h-5 w-5 shrink-0 text-rose-600 mt-0.5" />
            <div className="flex-1">
              {state.message?.startsWith("DUPLICATE_BILL:") ? (
                <div>
                  <p className="font-bold">Duplicate Supplier Invoice Blocked</p>
                  <p className="mt-1 text-xs text-rose-700">
                    A bill with this invoice number from this supplier was already recorded in the system.
                  </p>
                  {state.receiptId && (
                    <a
                      href={`/purchases/${state.receiptId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-rose-800 transition-colors"
                    >
                      <span>Open Existing Receipt #{state.receiptId.slice(-6)}</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              ) : (
                <span>{state.message}</span>
              )}
            </div>
          </div>
        )}

        {/* Similar Bill Warning Modal */}
        {(state.status === "similar_warning" || similarBillWarning) && (
          <div className="amb-pop-in rounded-2xl border-2 border-amber-300 bg-amber-50/95 p-5 text-sm text-amber-950 shadow-md">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-200 text-amber-800 font-bold">
                !
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-base text-amber-950">Similar Invoice Number Warning</h3>
                <p className="mt-1 text-xs text-amber-900 leading-relaxed">
                  {state.status === "similar_warning"
                    ? state.message
                    : similarBillWarning?.message}
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="submit"
                    onClick={() => setAcknowledgedSimilar(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-700 transition-colors"
                  >
                    <span>Yes, Continue Saving</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  {state.receiptId && (
                    <a
                      href={`/purchases/${state.receiptId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-50"
                    >
                      <span>Inspect Previous Bill</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSimilarBillWarning(null);
                    }}
                    className="text-xs font-semibold text-amber-800 hover:underline px-2"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Automatic Offline / Refresh Recovery Banner */}
        {hasRestoredDraft && (
          <div className="amb-pop-in flex items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-xs text-sky-900 shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-white font-bold text-[10px]">
                ✓
              </span>
              <span>
                <b>Draft restored!</b> Your entered purchase quantities, invoice details, and rates were preserved automatically across refresh.
              </span>
            </div>
            <button
              type="button"
              onClick={resetDraft}
              className="inline-flex items-center gap-1 font-semibold text-rose-600 hover:text-rose-800 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Clear Draft</span>
            </button>
          </div>
        )}

        {/* AI Smart Bill Reader with side-by-side verification preview */}
        <BillReader
          onDraft={applyDraft}
          onFileLoaded={(file) => {
            setBillPreview(file);
            if (file) setShowBillDrawer(true);
          }}
        />

        {billNote?.supplier && (
          <div className="amb-pop-in flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-900 shadow-2xs">
            <Info className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Supplier on bill is <b>{billNote.supplier}</b>. Select or link their supplier profile below.
            </span>
          </div>
        )}

        {/* Invoice Header Details */}
        <div className="grid gap-6 lg:grid-cols-12">
          <div className={billPreview && showBillDrawer ? "lg:col-span-8" : "lg:col-span-12"}>
            <Card>
              <CardHeader
                title="Supplier & Invoice Details"
                subtitle="Record who supplied the merchandise and original billing credentials."
                action={
                  billPreview ? (
                    <button
                      type="button"
                      onClick={() => setShowBillDrawer(!showBillDrawer)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      <span>{showBillDrawer ? "Hide Bill Preview" : "View Split Bill Preview"}</span>
                    </button>
                  ) : null
                }
              />
              <div className="grid gap-4 px-6 pb-6 sm:grid-cols-3">
                <label className="text-xs font-semibold text-slate-700">
                  Supplier Name <span className="text-rose-500">*</span>
                  <select
                    name="supplierId"
                    required
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className={`${INPUT} mt-1.5`}
                  >
                    <option value="" disabled>
                      Select active supplier
                    </option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs font-semibold text-slate-700">
                  Invoice Number <span className="text-rose-500">*</span>
                  <input
                    name="supplierInvoiceNo"
                    required
                    maxLength={60}
                    placeholder="e.g. INV-2026-904"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    className={`${INPUT} mt-1.5`}
                  />
                </label>

                <label className="text-xs font-semibold text-slate-700">
                  Invoice Date <span className="font-normal text-slate-400">(optional)</span>
                  <input
                    name="supplierInvoiceDate"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className={`${INPUT} mt-1.5`}
                  />
                </label>
              </div>

              {/* Edge Case 3: Bill-Level Discounts & Freight Cost Allocation */}
              <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <Percent className="h-3.5 w-3.5 text-indigo-600" />
                    Bill-Level Charges & Proration (Landed Cost)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Discounts & transport are prorated across lines to calculate true WAC.
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
                    <label className="block text-xs font-medium text-slate-600">
                      Invoice Cash Discount / Scheme Off
                    </label>
                    <div className="mt-1.5 flex gap-2">
                      <div className="flex rounded-lg border border-slate-300 bg-slate-100 p-0.5 text-xs font-semibold">
                        <button
                          type="button"
                          onClick={() => setDiscountType("fixed")}
                          className={`rounded-md px-2 py-1 ${discountType === "fixed" ? "bg-white text-indigo-600 shadow-2xs" : "text-slate-600"}`}
                        >
                          ₹
                        </button>
                        <button
                          type="button"
                          onClick={() => setDiscountType("percent")}
                          className={`rounded-md px-2 py-1 ${discountType === "percent" ? "bg-white text-indigo-600 shadow-2xs" : "text-slate-600"}`}
                        >
                          %
                        </button>
                      </div>
                      <input
                        value={discountValue}
                        onChange={(e) => setDiscountValue(e.target.value)}
                        placeholder={discountType === "percent" ? "e.g. 5" : "e.g. 500"}
                        className="amb-focus block min-h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
                    <label className="block text-xs font-medium text-slate-600 flex items-center gap-1.5">
                      <Truck className="h-3.5 w-3.5 text-amber-600" />
                      Transport / Freight / Packing (₹)
                    </label>
                    <div className="mt-1.5 relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-slate-400">
                        ₹
                      </span>
                      <input
                        value={freightCharges}
                        onChange={(e) => setFreightCharges(e.target.value)}
                        placeholder="e.g. 250"
                        className="amb-focus block min-h-9 w-full rounded-lg border border-slate-300 pl-7 pr-3 text-xs text-slate-900"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Split Screen Bill Preview Drawer */}
          {billPreview && showBillDrawer && (
            <div className="lg:col-span-4">
              <div className="sticky top-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-violet-600" />
                    <span className="text-xs font-bold text-slate-800 truncate max-w-[180px]">
                      {billPreview.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <a
                      href={billPreview.url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 rounded text-slate-400 hover:text-slate-600"
                      title="Open full view"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => setShowBillDrawer(false)}
                      className="p-1 rounded text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-100 bg-slate-50 flex items-center justify-center min-h-[360px] max-h-[500px]">
                  {billPreview.isPdf ? (
                    <iframe src={billPreview.url} className="w-full h-[460px] rounded-lg" title="PDF Bill" />
                  ) : (
                    <img
                      src={billPreview.url}
                      alt="Supplier bill"
                      className="max-h-[460px] w-auto object-contain cursor-zoom-in"
                      onClick={() => window.open(billPreview.url, "_blank")}
                    />
                  )}
                </div>
                <p className="mt-2 text-center text-[11px] text-slate-400">
                  Click image to expand in a full-sized tab for easy line verification.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Unmatched Bill Items with Auto-Alias learning */}
        {unmatched.length > 0 && (
          <Card>
            <CardHeader
              title={`Items Needing Product Match (${unmatched.length})`}
              subtitle="The bill reader detected these lines. Pick an existing product or create one; AMBURAX will remember this supplier's alias for future invoices."
            />
            <ul className="divide-y divide-slate-100">
              {unmatched.map((u, i) => (
                <li key={i} className="space-y-3 p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">{u.billText}</p>
                      <p className="text-xs text-slate-500">
                        Qty: <b>{u.quantity}</b> · Read Rate: <b>{u.unitCostMinor != null ? formatMinor(u.unitCostMinor) : "Not found"}</b> · GST: {u.gstRateBp / 100}%
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setResolving(resolving === i ? null : i)}
                      className={`${buttonClass("secondary")} text-xs font-semibold`}
                    >
                      {resolving === i ? "Cancel" : "Map to Product / Create"}
                    </button>
                  </div>
                  {resolving === i && (
                    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
                      <p className="mb-2 text-xs font-bold text-violet-900">
                        Map &quot;{u.billText}&quot; to your inventory:
                      </p>
                      <PurchaseItemPicker
                        onPick={(lines) => void resolveUnmatched(i, lines)}
                        canCreateProducts={canCreateProducts}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Expandable Garment Purchase Matrix */}
        <Card>
          <CardHeader
            title="Received Garment Styles & Matrix"
            subtitle="Search any style or scan a tag. Size variations are cleanly grouped for fast bulk receiving."
          />

          <div className="px-6 pb-4">
            <PurchaseItemPicker onPick={addPicked} canCreateProducts={canCreateProducts} />
          </div>

          {groupedStyles.length === 0 ? (
            <div className="border-t border-slate-100 px-6 py-12 text-center">
              <Layers className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-700">No items added to invoice</p>
              <p className="text-xs text-slate-500">
                Search an apparel style above, scan a barcode, or upload a supplier bill.
              </p>
            </div>
          ) : (
            <div className="border-t border-slate-200 divide-y divide-slate-200">
              {groupedStyles.map((group) => {
                const groupItems = group.items;
                const groupTotalQty = groupItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
                const sampleItem = groupItems[0]!;

                return (
                  <div key={group.key} className="p-6 bg-white hover:bg-slate-50/30 transition-colors">
                    {/* Style Header Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-slate-900">{group.productName}</h3>
                          {group.colour && (
                            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 border border-slate-200">
                              {group.colour}
                            </span>
                          )}
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">
                            {groupTotalQty} pcs across {groupItems.length} sizes
                          </span>
                        </div>
                        {sampleItem.check && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                            {sampleItem.check}
                          </p>
                        )}
                      </div>

                      {/* Quick Bulk Actions for this Style */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Edge Case 2: Ratio / Set Fill Button */}
                        <button
                          type="button"
                          onClick={() => {
                            setRatioModalGroupKey(group.key);
                            setRatioQtyInput("1");
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2.5 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Fill Set / Ratio</span>
                        </button>

                        {/* Bulk Apply Cost & GST to all sizes in this group */}
                        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                          <span className="text-[11px] font-medium text-slate-500 pl-1">Batch Rate:</span>
                          <div className="relative">
                            <span className="absolute inset-y-0 left-0 pl-1.5 flex items-center text-xs text-slate-400">₹</span>
                            <input
                              defaultValue={sampleItem.cost}
                              onBlur={(e) => applyRateToGroup(group.key, e.target.value, sampleItem.gstRateBp)}
                              placeholder="Rate"
                              className="h-7 w-20 rounded border border-slate-300 pl-4 pr-1 text-xs font-semibold text-right"
                              title="Press Tab/click away to apply this purchase rate to all sizes in this style"
                            />
                          </div>
                          <select
                            value={sampleItem.gstRateBp}
                            onChange={(e) => applyRateToGroup(group.key, sampleItem.cost, Number(e.target.value))}
                            className="h-7 rounded border border-slate-300 bg-white px-1 text-[11px] font-medium"
                          >
                            {GST_RATES.map((rate) => (
                              <option key={rate} value={rate}>
                                {rate / 100}% GST
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Size Matrix Grid */}
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                      {groupItems.map((item) => {
                        const pricedItem = priced.find((p) => p.variantId === item.variantId);
                        const qtyNum = Number(item.quantity) || 0;

                        return (
                          <div
                            key={item.variantId}
                            className={`relative rounded-xl border p-3 transition-all ${
                              qtyNum > 0
                                ? "border-indigo-300 bg-indigo-50/20 shadow-2xs"
                                : "border-slate-200 bg-slate-50/30 opacity-75"
                            }`}
                          >
                            <div className="flex items-baseline justify-between gap-1">
                              <span className="text-sm font-extrabold text-slate-900">
                                {item.size || "Standard"}
                              </span>
                              <span className="text-[11px] text-slate-500 tabular-nums">
                                {item.stock !== null ? `${item.stock} in stock` : "new"}
                              </span>
                            </div>

                            <p className="mt-0.5 text-[11px] text-slate-400 font-mono truncate">
                              {item.sku}
                            </p>

                            {/* Quantity Input */}
                            <div className="mt-2.5">
                              <label className="block text-[11px] font-semibold text-slate-600">
                                Received Qty (Pcs)
                              </label>
                              <input
                                ref={(el) => {
                                  if (el) rowQtyRefs.current.set(item.variantId, el);
                                  else rowQtyRefs.current.delete(item.variantId);
                                }}
                                inputMode="numeric"
                                value={item.quantity}
                                onChange={(e) => updateRow(item.variantId, { quantity: e.target.value })}
                                placeholder="0"
                                className="amb-focus mt-1 block h-9 w-full rounded-lg border border-slate-300 px-2 text-center text-sm font-bold text-slate-900 shadow-2xs"
                              />
                            </div>

                            {/* Cost & GST */}
                            <div className="mt-2 grid grid-cols-2 gap-1.5">
                              <div>
                                <label className="block text-[10px] text-slate-500">Cost (ex. GST)</label>
                                <div className="relative mt-0.5">
                                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-1.5 text-[11px] text-slate-400">
                                    ₹
                                  </span>
                                  <input
                                    value={item.cost}
                                    onChange={(e) => updateRow(item.variantId, { cost: e.target.value })}
                                    className="h-8 w-full rounded border border-slate-300 pl-4 pr-1 text-right text-xs font-medium"
                                  />
                                </div>
                              </div>

                              <div>
                                <label className="block text-[10px] text-slate-500">GST %</label>
                                <select
                                  value={item.gstRateBp}
                                  onChange={(e) => updateRow(item.variantId, { gstRateBp: Number(e.target.value) })}
                                  className="mt-0.5 h-8 w-full rounded border border-slate-300 bg-white px-1 text-xs"
                                >
                                  {GST_RATES.map((rate) => (
                                    <option key={rate} value={rate}>
                                      {rate / 100}%
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            {/* Edge Case 1: Same Style New MRP / Lot Price Policy Handling */}
                            <div className="mt-2.5 border-t border-slate-200/60 pt-2">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-slate-500">
                                  Sell: <b>{formatMinor(item.currentPriceMinor)}</b>
                                  {item.currentMrpMinor ? ` (MRP ${formatMinor(item.currentMrpMinor)})` : ""}
                                </span>
                                <label className="flex items-center gap-1 font-semibold text-indigo-600 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={item.updatePrice}
                                    onChange={(e) => updateRow(item.variantId, { updatePrice: e.target.checked })}
                                    className="rounded border-slate-300 text-indigo-600"
                                  />
                                  <span>Change</span>
                                </label>
                              </div>

                              {item.updatePrice && (
                                <div className="amb-fade-in mt-1.5 space-y-1 rounded-lg border border-amber-200 bg-amber-50/50 p-2 text-xs">
                                  <div className="flex gap-1.5">
                                    <input
                                      placeholder="New Sell ₹"
                                      value={item.newPrice}
                                      onChange={(e) => updateRow(item.variantId, { newPrice: e.target.value })}
                                      className="h-7 w-1/2 rounded border border-slate-300 px-1.5 text-right text-[11px]"
                                    />
                                    <input
                                      placeholder="New MRP ₹"
                                      value={item.newMrp}
                                      onChange={(e) => updateRow(item.variantId, { newMrp: e.target.value })}
                                      className="h-7 w-1/2 rounded border border-slate-300 px-1.5 text-right text-[11px]"
                                    />
                                  </div>
                                  <select
                                    value={item.pricePolicy}
                                    onChange={(e) => updateRow(item.variantId, { pricePolicy: e.target.value as any })}
                                    className="h-7 w-full rounded border border-slate-300 bg-white px-1 text-[10px]"
                                  >
                                    <option value="after_older_stock">Apply when old stock sells out</option>
                                    <option value="now">Apply immediately (Retag all)</option>
                                  </select>
                                </div>
                              )}
                            </div>

                            {/* Landed Line Totals & Remove */}
                            <div className="mt-2.5 flex items-center justify-between pt-1.5 border-t border-slate-100 text-[11px]">
                              <span className="font-semibold text-slate-700">
                                Total: {formatMinor(pricedItem?.finalLineTotal ?? 0)}
                              </span>
                              <button
                                type="button"
                                onClick={() => setRows((rs) => rs.filter((x) => x.variantId !== item.variantId))}
                                className="text-slate-400 hover:text-rose-600"
                                title="Remove size"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer Totals with Prorated Tax & Freight reconciliation */}
          <div className="flex flex-wrap items-start justify-between gap-6 px-6 py-5 border-t border-slate-200 bg-slate-50/60 rounded-b-2xl">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-700">
                {rows.length} {rows.length === 1 ? "size variant" : "size variants"} ·{" "}
                <span className="text-indigo-600 font-bold">{totalPieces} pieces total</span>
              </p>
              {printablePurchaseItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setBarcodeModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 shadow-2xs transition-all"
                >
                  <Printer className="h-4 w-4" />
                  <span>🖨️ Print Received Barcode Stickers ({totalPieces} pcs)</span>
                </button>
              )}
            </div>

            <dl className="min-w-[260px] space-y-1.5 text-sm">
              <div className="flex justify-between gap-6">
                <dt className="text-slate-600">Base Goods Value</dt>
                <dd className="tabular-nums font-medium text-slate-900">{formatMinor(baseTaxableSum)}</dd>
              </div>

              {discountMinor > 0 && (
                <div className="flex justify-between gap-6 text-emerald-700">
                  <dt>Invoice Discount</dt>
                  <dd className="tabular-nums font-semibold">
                    - {formatMinor(discountType === "percent" ? Math.round((baseTaxableSum * (Number(discountValue) || 0)) / 100) : discountMinor)}
                  </dd>
                </div>
              )}

              {freightMinor > 0 && (
                <div className="flex justify-between gap-6 text-amber-700">
                  <dt>Transport / Freight</dt>
                  <dd className="tabular-nums font-semibold">+ {formatMinor(freightMinor)}</dd>
                </div>
              )}

              <div className="flex justify-between gap-6">
                <dt className="text-slate-600">Net Taxable Value</dt>
                <dd className="tabular-nums font-medium text-slate-900">{formatMinor(totalTaxable)}</dd>
              </div>

              <div className="flex justify-between gap-6">
                <dt className="text-slate-600">Input GST (CGST/SGST/IGST)</dt>
                <dd className="tabular-nums font-medium text-slate-900">{formatMinor(totalTax)}</dd>
              </div>

              <div className="flex justify-between gap-6 border-t border-slate-300 pt-2 text-base font-bold text-slate-900">
                <dt>Invoice Payable Grand Total</dt>
                <dd className="tabular-nums text-indigo-700">{formatMinor(grandTotal)}</dd>
              </div>

              {billNote?.totalMinor != null && (
                <div
                  className={`flex justify-between gap-6 text-xs pt-1 ${
                    Math.abs(billNote.totalMinor - grandTotal) > 100
                      ? "font-semibold text-rose-700"
                      : "text-emerald-700 font-semibold"
                  }`}
                >
                  <dt>Bill Total Check</dt>
                  <dd className="tabular-nums">
                    {formatMinor(billNote.totalMinor)}{" "}
                    {Math.abs(billNote.totalMinor - grandTotal) > 100
                      ? `(Diff: ${formatMinor(Math.abs(billNote.totalMinor - grandTotal))})`
                      : "✓ Exactly matches"}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </Card>

        {/* Notes */}
        <label className="block text-xs font-semibold text-slate-700">
          Internal Notes / Wholesaler Remarks <span className="font-normal text-slate-400">(optional)</span>
          <textarea
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. Lot #18, festival advance stock, freight paid via VRL Logistics"
            className={`${INPUT} mt-1.5 py-2.5`}
          />
        </label>

        {/* Action Bar */}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          {printablePurchaseItems.length > 0 && (
            <button
              type="button"
              onClick={() => setBarcodeModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs"
            >
              <Barcode className="h-4 w-4" />
              <span>Preview Barcodes</span>
            </button>
          )}

          <button
            type="submit"
            disabled={pending || rows.length === 0 || priced.some((r) => !r.ok)}
            aria-busy={pending}
            className={`${buttonClass("primary")} amb-press px-6 py-2.5 text-sm font-bold shadow-sm`}
          >
            {pending ? "Saving & Receiving Stock…" : "Save & Update Inventory"}
          </button>
        </div>
      </form>

      {/* Ratio Fill Modal */}
      {ratioModalGroupKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Fill Set / Ratio Quantity</h3>
            <p className="mt-1 text-xs text-slate-600">
              Enter the number of pieces received for each size in this style set.
            </p>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700">Pieces Per Size</label>
              <input
                autoFocus
                type="number"
                min="1"
                value={ratioQtyInput}
                onChange={(e) => setRatioQtyInput(e.target.value)}
                className={`${INPUT} mt-1.5 text-center text-lg font-bold`}
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRatioModalGroupKey(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => applyRatioFill(ratioModalGroupKey, Math.max(1, Number(ratioQtyInput) || 1))}
                className={`${buttonClass("primary")} text-xs font-bold px-4 py-2`}
              >
                Apply to All Sizes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Print Modal */}
      {barcodeModalOpen && (
        <BarcodeLabelModal
          isOpen={barcodeModalOpen}
          onClose={() => setBarcodeModalOpen(false)}
          variants={printablePurchaseItems}
          title="Print Barcode Stickers for Received Stock"
        />
      )}
    </>
  );
}
