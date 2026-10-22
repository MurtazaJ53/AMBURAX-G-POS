"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMinor } from "@/server/sales/saleTotals";
import { BadgeTone, StatusBadge, buttonClass } from "../../_components/ui";
import { PrintBarcodeButton } from "./PrintBarcodeButton";
import { BarcodeSvg } from "@/client/hardware/BarcodeSvg";
import {
  Package,
  Layers,
  Tag,
  Barcode,
  History,
  ShoppingBag,
  ExternalLink,
  Edit,
  Building2,
  CheckCircle,
  XCircle,
  Image as ImageIcon,
  Copy,
} from "lucide-react";

interface VariantDetail {
  id: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  costPriceMinor: number | null;
  priceMinor: number | null;
  mrpMinor: number | null;
  minPriceMinor?: number | null;
  taxRateBp: number;
  taxRateMode: string;
  taxTreatment: string;
  isActive: boolean;
  stockQuantity: number | null;
  stockLevels?: Array<{ quantity: number }>;
}

interface ProductDetailsViewProps {
  product: {
    id: string;
    name: string;
    category: string | null;
    brand: string | null;
    imageUrl: string | null;
    hsnCode?: string | null;
    isActive: boolean;
    createdAt: string | Date;
    updatedAt: string | Date;
    baseUom?: { id: string; name: string; code: string } | null;
    variants: VariantDetail[];
  };
  canManage: boolean;
  storeName?: string;
  recentSales?: Array<{
    id: string;
    billNumber: string;
    completedAt: string | Date;
    totalMinor: number;
    cashierName: string;
    quantity: number;
  }>;
}

export function ProductDetailsView({
  product,
  canManage,
  storeName,
  recentSales = [],
}: ProductDetailsViewProps) {
  const [activeTab, setActiveTab] = useState<
    "overview" | "variants" | "locations" | "barcodes" | "sales"
  >("overview");
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [duplicateName, setDuplicateName] = useState(`${product.name} (Copy)`);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const router = useRouter();

  async function handleDuplicate() {
    if (!duplicateName.trim()) {
      setDuplicateError("Enter a product name.");
      return;
    }
    setIsDuplicating(true);
    setDuplicateError(null);
    try {
      const res = await fetch(`/api/v1/products/${product.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: duplicateName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDuplicateError(data?.error?.message ?? data?.message ?? "Could not duplicate product.");
        return;
      }
      setDuplicateModalOpen(false);
      router.push(`/products/${data.productId}`);
      router.refresh();
    } catch {
      setDuplicateError("Connection error. Try again.");
    } finally {
      setIsDuplicating(false);
    }
  }

  const printableVariants = product.variants.map((v) => ({
    id: v.id,
    sku: v.sku,
    barcode: v.barcode,
    productName: product.name,
    size: v.size,
    colour: v.colour,
    priceMinor: v.priceMinor ?? 0,
    mrpMinor: v.mrpMinor,
    quantity: v.stockQuantity && v.stockQuantity > 0 ? v.stockQuantity : 1,
  }));

  const totalStock = product.variants.reduce((acc, v) => acc + (v.stockQuantity || 0), 0);
  const minPrice = Math.min(...product.variants.map((v) => v.priceMinor || 0));
  const maxPrice = Math.max(...product.variants.map((v) => v.priceMinor || 0));

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.name}
                className="h-20 w-20 rounded-xl border border-slate-200 object-cover shadow-2xs"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400">
                <ImageIcon className="h-8 w-8 stroke-[1.5]" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">{product.name}</h1>
                <StatusBadge tone={(product.isActive ? "success" : "neutral") as BadgeTone}>
                  {product.isActive ? "Active" : "Archived"}
                </StatusBadge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500 font-medium">
                {product.brand && (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700">
                    Brand: <strong>{product.brand}</strong>
                  </span>
                )}
                {product.category && (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700">
                    Category: <strong>{product.category}</strong>
                  </span>
                )}
                {product.baseUom && (
                  <span>
                    UOM: <strong>{product.baseUom.name} ({product.baseUom.code})</strong>
                  </span>
                )}
                {product.hsnCode && (
                  <span>
                    HSN: <strong className="font-mono">{product.hsnCode}</strong>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start">
            <PrintBarcodeButton
              variants={printableVariants}
              storeName={storeName}
              buttonLabel="Print Labels"
            />
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => setDuplicateModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <Copy className="h-4 w-4 text-slate-500" />
                  <span>Duplicate</span>
                </button>
                <Link href={`/products/${product.id}/edit`} className={buttonClass("primary")}>
                  <Edit className="h-4 w-4 mr-1.5" /> Edit Product
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Quick KPI Strip */}
        <div className="mt-6 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5 sm:grid-cols-4">
          <div className="rounded-xl bg-slate-50/70 p-3">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Variants</div>
            <div className="text-xl font-bold text-slate-900 mt-0.5">{product.variants.length}</div>
          </div>
          <div className="rounded-xl bg-slate-50/70 p-3">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Units on Hand</div>
            <div className="text-xl font-bold text-sky-950 mt-0.5">{totalStock.toLocaleString()}</div>
          </div>
          <div className="rounded-xl bg-slate-50/70 p-3">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Retail Price Range</div>
            <div className="text-xl font-bold text-slate-900 mt-0.5">
              {minPrice === maxPrice
                ? formatMinor(minPrice)
                : `${formatMinor(minPrice)} - ${formatMinor(maxPrice)}`}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50/70 p-3">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Statutory Tax Mode</div>
            <div className="text-xs font-bold text-slate-800 mt-1">
              {product.variants[0]?.taxRateMode === "APPAREL_SLAB"
                ? "APPAREL SLAB (5% / 18%)"
                : `${(product.variants[0]?.taxRateBp ?? 0) / 100}% GST`}
            </div>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              activeTab === "overview"
                ? "bg-primary text-white shadow-xs"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Package className="h-4 w-4" /> Overview & Attributes
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("variants")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              activeTab === "variants"
                ? "bg-primary text-white shadow-xs"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Layers className="h-4 w-4" /> Variants Matrix ({product.variants.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("barcodes")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              activeTab === "barcodes"
                ? "bg-primary text-white shadow-xs"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Barcode className="h-4 w-4" /> Barcodes & Thermal Stickers
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("sales")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              activeTab === "sales"
                ? "bg-primary text-white shadow-xs"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <History className="h-4 w-4" /> Sales History ({recentSales.length})
          </button>
        </div>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">Master Information</h2>
            <dl className="divide-y divide-slate-100 text-xs">
              <div className="flex justify-between py-2">
                <dt className="text-slate-500 font-medium">Canonical ID</dt>
                <dd className="font-mono font-semibold text-slate-800">{product.id}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-500 font-medium">Category</dt>
                <dd className="font-semibold text-slate-800">{product.category || "Uncategorized"}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-500 font-medium">Brand / Label</dt>
                <dd className="font-semibold text-slate-800">{product.brand || "None"}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-500 font-medium">Measurement Unit (UOM)</dt>
                <dd className="font-semibold text-slate-800">{product.baseUom ? `${product.baseUom.name} (${product.baseUom.code})` : "PCS"}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-500 font-medium">HSN Code</dt>
                <dd className="font-mono font-semibold text-slate-800">{product.hsnCode || "61091000"}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-500 font-medium">Created On</dt>
                <dd className="font-semibold text-slate-800">{new Date(product.createdAt).toLocaleDateString("en-IN")}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">Pricing & Statutory Overview</h2>
            <dl className="divide-y divide-slate-100 text-xs">
              <div className="flex justify-between py-2">
                <dt className="text-slate-500 font-medium">Lowest Variant Selling Price</dt>
                <dd className="font-bold text-slate-900">{formatMinor(minPrice)}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-500 font-medium">Highest Variant Selling Price</dt>
                <dd className="font-bold text-slate-900">{formatMinor(maxPrice)}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-500 font-medium">GST Classification</dt>
                <dd className="font-semibold text-slate-800">{product.variants[0]?.taxTreatment || "TAXABLE"}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-500 font-medium">Apparel Slab Mode</dt>
                <dd className="font-semibold text-primary">{product.variants[0]?.taxRateMode || "APPAREL_SLAB"}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-500 font-medium">Current Slab Threshold</dt>
                <dd className="font-semibold text-slate-800">5% ≤ ₹2,500 | 18% &gt; ₹2,500</dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      {/* TAB 2: VARIANTS MATRIX */}
      {activeTab === "variants" && (
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                  <th className="py-2.5 px-4">Size</th>
                  <th className="py-2.5 px-4">Colour</th>
                  <th className="py-2.5 px-4">SKU</th>
                  <th className="py-2.5 px-4">Barcode</th>
                  <th className="py-2.5 px-4 text-right">Cost Price</th>
                  <th className="py-2.5 px-4 text-right">Selling Price</th>
                  <th className="py-2.5 px-4 text-right">MRP</th>
                  <th className="py-2.5 px-4 text-right">On Hand</th>
                  <th className="py-2.5 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {product.variants.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 font-bold text-slate-900">{v.size || "Free Size"}</td>
                    <td className="py-3 px-4 font-medium text-slate-700">{v.colour || "Standard"}</td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600">{v.sku}</td>
                    <td className="py-3 px-4 font-mono font-semibold text-sky-950">{v.barcode || "—"}</td>
                    <td className="py-3 px-4 text-right font-medium text-slate-600">
                      {v.costPriceMinor != null ? formatMinor(v.costPriceMinor) : "—"}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-slate-900">
                      {v.priceMinor != null ? formatMinor(v.priceMinor) : "—"}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-slate-500">
                      {v.mrpMinor != null ? formatMinor(v.mrpMinor) : "—"}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-sky-900">
                      {(v.stockQuantity ?? 0).toLocaleString()} pcs
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        v.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}>
                        {v.isActive ? "Active" : "Disabled"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: BARCODES */}
      {activeTab === "barcodes" && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Barcodes & Sticker Printing</h2>
              <p className="text-xs text-slate-500">50×25mm thermal printer labels ready for shelf tagging</p>
            </div>
            <PrintBarcodeButton
              variants={printableVariants}
              storeName={storeName}
              buttonLabel="Print All Labels"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {product.variants.map((v) => (
              <div key={v.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="font-bold text-slate-900">{[v.size, v.colour].filter(Boolean).join(" · ") || "Standard"}</span>
                  <span className="text-xs font-semibold text-primary">{v.priceMinor != null ? formatMinor(v.priceMinor) : ""}</span>
                </div>
                <div className="font-mono text-xs text-slate-500">{v.sku}</div>
                {v.barcode ? (
                  <div className="pt-2 flex flex-col items-center justify-center bg-white p-2 rounded-lg border border-slate-200/60">
                    <BarcodeSvg barcode={v.barcode} />
                    <span className="font-mono text-[11px] font-bold tracking-widest text-slate-700 mt-1">{v.barcode}</span>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 italic py-4 text-center">No barcode assigned</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: SALES HISTORY */}
      {activeTab === "sales" && (
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
          <div className="border-b border-slate-100 p-4">
            <h2 className="text-sm font-bold text-slate-900">Recent Counter Sales</h2>
            <p className="text-xs text-slate-500">Sales recorded at till registers containing this item</p>
          </div>
          {recentSales.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No sales have been recorded for this product yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                    <th className="py-2.5 px-4">Bill Number</th>
                    <th className="py-2.5 px-4">Date & Time</th>
                    <th className="py-2.5 px-4">Cashier</th>
                    <th className="py-2.5 px-4 text-right">Units Sold</th>
                    <th className="py-2.5 px-4 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentSales.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-mono font-bold text-primary">{s.billNumber}</td>
                      <td className="py-3 px-4 text-slate-600">
                        {new Date(s.completedAt).toLocaleString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-3 px-4 text-slate-700">{s.cashierName}</td>
                      <td className="py-3 px-4 text-right font-medium">{s.quantity}</td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900">
                        {formatMinor(s.totalMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Duplicate Product Modal */}
      {duplicateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl amb-pop-in">
            <div className="flex items-center gap-2 text-slate-900 mb-1">
              <Copy className="h-5 w-5 text-primary" />
              <h3 className="text-base font-bold">Duplicate Product</h3>
            </div>
            <p className="text-xs text-slate-600 mb-4">
              Creates an exact clone of this style including its {product.variants.length} variant combinations, category, brand, and pricing rules.
            </p>

            {duplicateError && (
              <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
                {duplicateError}
              </div>
            )}

            <label className="block text-xs font-semibold text-slate-700 mb-1">
              New Product Name <span className="text-red-500">*</span>
            </label>
            <input
              autoFocus
              value={duplicateName}
              onChange={(e) => setDuplicateName(e.target.value)}
              placeholder="e.g. 4 way V2"
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDuplicateModalOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDuplicating || !duplicateName.trim()}
                onClick={handleDuplicate}
                className={`${buttonClass("primary")} text-xs font-bold px-4 py-2 shadow-sm`}
              >
                {isDuplicating ? "Duplicating…" : "Duplicate & Open"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
