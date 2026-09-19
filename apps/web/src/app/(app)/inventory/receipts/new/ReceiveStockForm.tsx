"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Hash, FileText } from "lucide-react";

export function ReceiveStockForm({ variants, storeId }: { variants: any[], storeId: string }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const requestKeyRef = React.useRef<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!requestKeyRef.current) {
      requestKeyRef.current = crypto.randomUUID();
    }

    const formData = new FormData(e.currentTarget);
    const variantId = formData.get("variantId") as string;
    const quantity = parseInt(formData.get("quantity") as string, 10);
    const reason = formData.get("reason") as string;

    const payload = {
      storeId,
      variantId,
      quantity,
      reason,
      requestKey: requestKeyRef.current
    };

    try {
      const res = await fetch("/api/v1/inventory/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Failed to receive stock");
        setLoading(false);
      } else {
        router.push("/inventory?success=receipt_created");
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      setLoading(false);
    }
  }

  return (
    <Card className="max-w-2xl mx-auto shadow-sm">
      <CardHeader>
        <CardTitle>Receive Stock</CardTitle>
        <CardDescription>
          Record incoming stock for products. This will immediately increase the available inventory in this store.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-300">Error</h3>
              <div className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</div>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="variantId" className="block text-sm font-medium text-primary">
              Product Variant
            </label>
            <div className="relative">
              <Package className="absolute left-3 top-3 h-4 w-4 text-tertiary" />
              <select
                id="variantId"
                name="variantId"
                required
                className="flex h-10 w-full appearance-none rounded-md border border-border bg-background-card pl-9 pr-8 py-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                <option value="">Select a variant...</option>
                {variants.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name} • {v.sku}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-tertiary">
                <svg className="h-4 w-4 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                  <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                </svg>
              </div>
            </div>
            {variants.length === 0 && (
              <p className="text-xs text-red-500">No active variants found in this store.</p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="quantity" className="block text-sm font-medium text-primary">
              Quantity to Receive
            </label>
            <div className="relative">
              <Hash className="absolute left-3 top-3 h-4 w-4 text-tertiary" />
              <Input
                type="number"
                name="quantity"
                id="quantity"
                min="1"
                required
                placeholder="e.g. 50"
                className="pl-9"
              />
            </div>
            <p className="text-xs text-secondary">
              Must be a positive integer matching the product&apos;s base unit of measure.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="reason" className="block text-sm font-medium text-primary">
              Reference / Reason <span className="text-tertiary font-normal">(Optional)</span>
            </label>
            <div className="relative">
              <FileText className="absolute left-3 top-3 h-4 w-4 text-tertiary" />
              <Input
                type="text"
                name="reason"
                id="reason"
                maxLength={500}
                placeholder="e.g. PO-2026-09-19"
                className="pl-9"
              />
            </div>
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
            {loading ? "Receiving..." : "Receive Stock"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
