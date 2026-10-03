"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Package, Hash, FileText, TrendingDown, TrendingUp, Minus } from "lucide-react";

interface VariantOption {
  id: string;
  sku: string;
  name: string;
  imageUrl?: string | null;
}

interface Props {
  variants: VariantOption[];
  storeId: string;
  stockByVariant: Record<string, number>;
}

export function AdjustStockForm({ variants, storeId, stockByVariant }: Props) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState(false);

  // Stable request key per form instance — same UUID sent on every retry.
  const requestKeyRef = React.useRef<string | null>(null);

  // Live preview state
  const [selectedVariantId, setSelectedVariantId] = React.useState("");
  const [deltaRaw, setDeltaRaw] = React.useState("");

  const currentStock =
    selectedVariantId !== "" ? (stockByVariant[selectedVariantId] ?? 0) : null;
  const deltaNum = deltaRaw !== "" && deltaRaw !== "-" ? parseInt(deltaRaw, 10) : null;
  const resultStock =
    currentStock !== null && deltaNum !== null && !isNaN(deltaNum)
      ? currentStock + deltaNum
      : null;

  const deltaIsPositive = deltaNum !== null && deltaNum > 0;
  const deltaIsNegative = deltaNum !== null && deltaNum < 0;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!requestKeyRef.current) {
      requestKeyRef.current = crypto.randomUUID();
    }

    const formData = new FormData(e.currentTarget);
    const variantId = formData.get("variantId") as string;
    const quantityDelta = parseInt(formData.get("quantityDelta") as string, 10);
    const reason = formData.get("reason") as string;

    const payload = {
      storeId,
      variantId,
      quantityDelta,
      reason,
      requestKey: requestKeyRef.current,
    };

    try {
      const res = await fetch("/api/v1/inventory/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Failed to adjust stock.");
        setLoading(false);
        // Reset request key on error so next attempt gets a fresh idempotency key
        requestKeyRef.current = null;
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push("/inventory/movements");
          router.refresh();
        }, 1200);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(msg);
      setLoading(false);
      requestKeyRef.current = null;
    }
  }

  if (success) {
    return (
      <Card className="max-w-2xl mx-auto shadow-sm">
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <svg
              className="h-8 w-8 text-green-600 dark:text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="text-lg font-semibold text-primary">Adjustment Recorded</p>
            <p className="mt-1 text-sm text-secondary">
              Stock has been updated. Redirecting to movement history…
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl mx-auto shadow-sm">
      <CardHeader>
        {/* This card is the page, so its title is the page's h1 — one heading, not two. */}
        <CardTitle as="h1">Adjust Stock</CardTitle>
        <CardDescription>
          Correct inventory levels due to damage, loss, shrinkage, or data-entry errors. A reason is
          required for every adjustment.
        </CardDescription>
      </CardHeader>

      <form onSubmit={onSubmit}>
        <CardContent className="space-y-6">
          {error && (
            <div
              role="alert"
              className="rounded-md bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800"
            >
              <h3 className="text-sm font-medium text-red-800 dark:text-red-300">Error</h3>
              <div className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</div>
            </div>
          )}

          {/* Variant selector */}
          <div className="space-y-2">
            <label htmlFor="variantId" className="block text-sm font-medium text-primary">
              Product / Variant
            </label>
            <div className="relative">
              <Package className="absolute left-3 top-3 h-4 w-4 text-tertiary" />
              <select
                id="variantId"
                name="variantId"
                required
                value={selectedVariantId}
                onChange={(e) => setSelectedVariantId(e.target.value)}
                className="flex h-10 w-full appearance-none rounded-md border border-border bg-background-card pl-9 pr-8 py-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                <option value="">Select a variant…</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.sku}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-tertiary">
                <svg
                  className="h-4 w-4 fill-current"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                </svg>
              </div>
            </div>
            {variants.length === 0 && (
              <p className="text-xs text-red-500">No active variants found in this store.</p>
            )}
          </div>

          {/* Current stock preview */}
          {currentStock !== null && (
            <div className="rounded-lg border border-border bg-slate-50 dark:bg-slate-900/40 p-4">
              <p className="text-xs font-medium text-secondary uppercase tracking-wide mb-3">
                Stock Preview
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="space-y-1">
                  <p className="text-xs text-tertiary">Current</p>
                  <p className="text-xl font-bold tabular-nums text-primary">{currentStock}</p>
                </div>
                <div className="flex flex-col items-center justify-center space-y-1">
                  {deltaIsPositive ? (
                    <TrendingUp className="h-5 w-5 text-green-500" />
                  ) : deltaIsNegative ? (
                    <TrendingDown className="h-5 w-5 text-red-500" />
                  ) : (
                    <Minus className="h-5 w-5 text-tertiary" />
                  )}
                  <p
                    className={`text-lg font-bold tabular-nums ${
                      deltaIsPositive
                        ? "text-green-600 dark:text-green-400"
                        : deltaIsNegative
                          ? "text-red-600 dark:text-red-400"
                          : "text-tertiary"
                    }`}
                  >
                    {deltaNum !== null && !isNaN(deltaNum)
                      ? (deltaNum > 0 ? "+" : "") + deltaNum
                      : "—"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-tertiary">Result</p>
                  <p
                    className={`text-xl font-bold tabular-nums ${
                      resultStock !== null && resultStock < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-primary"
                    }`}
                  >
                    {resultStock !== null ? resultStock : "—"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Quantity delta */}
          <div className="space-y-2">
            <label htmlFor="quantityDelta" className="block text-sm font-medium text-primary">
              Adjustment Quantity
            </label>
            <div className="relative">
              <Hash className="absolute left-3 top-3 h-4 w-4 text-tertiary" />
              <Input
                type="number"
                name="quantityDelta"
                id="quantityDelta"
                required
                placeholder="e.g. -3 or +5"
                value={deltaRaw}
                onChange={(e) => setDeltaRaw(e.target.value)}
                className="pl-9"
              />
            </div>
            <p className="text-xs text-secondary">
              Use a <strong>negative</strong> number to write stock off (damage, loss), and a{" "}
              <strong>positive</strong> number to correct an undercount. Cannot be 0.
            </p>
          </div>

          {/* Reason — required by backend */}
          <div className="space-y-2">
            <label htmlFor="reason" className="block text-sm font-medium text-primary">
              Reason{" "}
              <span className="text-red-500" aria-label="required">
                *
              </span>
            </label>
            <div className="relative">
              <FileText className="absolute left-3 top-3 h-4 w-4 text-tertiary" />
              <Input
                type="text"
                name="reason"
                id="reason"
                required
                minLength={3}
                maxLength={500}
                placeholder="e.g. Damaged goods, inventory count correction, shrinkage"
                className="pl-9"
              />
            </div>
            <p className="text-xs text-secondary">
              Required. An unexplained adjustment is indistinguishable from a mistake.
            </p>
          </div>
        </CardContent>

        <CardFooter className="flex justify-between border-t border-border bg-slate-50 dark:bg-slate-900/50 p-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/inventory")}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={loading || variants.length === 0}
          >
            {loading ? "Adjusting…" : "Adjust Stock"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
