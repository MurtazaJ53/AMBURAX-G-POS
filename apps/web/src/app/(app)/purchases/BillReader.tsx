"use client";

import { useRef, useState } from "react";
import { Camera, Sparkles, FileText, X } from "lucide-react";
import { buttonClass } from "../_components/ui";
import type { BillDraft } from "@/server/purchasing/billScan";

/**
 * "Read supplier bill": a photo or PDF goes to the server, which asks the owner's AI
 * to read it and matches it to this shop's suppliers and products.
 * Also keeps an object URL preview for split/side-by-side verification with the purchase matrix!
 */
export function BillReader({
  onDraft,
  onFileLoaded,
}: {
  onDraft: (draft: BillDraft) => void;
  onFileLoaded?: (file: { name: string; url: string; isPdf: boolean } | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<{ name: string; url: string; isPdf: boolean } | null>(null);

  async function read(file: File) {
    setBusy(true);
    setError(null);

    // Create object URL for local side-by-side preview
    const previewUrl = URL.createObjectURL(file);
    const fileMeta = {
      name: file.name,
      url: previewUrl,
      isPdf: file.type === "application/pdf",
    };
    setCurrentFile(fileMeta);
    onFileLoaded?.(fileMeta);

    try {
      const body = new FormData();
      body.append("bill", file);
      const res = await fetch("/api/v1/purchases/scan", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? "Couldn't read the bill. Try again.");
        return;
      }
      onDraft(data.draft as BillDraft);
    } catch {
      setError("No connection. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function clearFile() {
    if (currentFile?.url) {
      URL.revokeObjectURL(currentFile.url);
    }
    setCurrentFile(null);
    onFileLoaded?.(null);
  }

  return (
    <div className="rounded-2xl border border-violet-200/80 bg-gradient-to-r from-violet-50/70 via-sky-50/40 to-indigo-50/60 p-4 shadow-sm backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-600 text-white shadow-xs">
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
            <span>Smart Upload Supplier Bill</span>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase text-violet-700">
              AI Vision
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Take a clear photo or upload wholesale PDF. AMBURAX extracts items, sets, sizes, and rates directly into the matrix.
          </p>
        </div>

        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          capture="environment"
          className="sr-only"
          aria-label="Supplier bill photo or PDF"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
          }}
        />

        <div className="flex items-center gap-2">
          {currentFile && (
            <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-white/90 px-3 py-1.5 text-xs text-slate-700 shadow-2xs">
              <FileText className="h-4 w-4 text-violet-600" />
              <span className="max-w-[140px] truncate font-medium">{currentFile.name}</span>
              <button
                type="button"
                onClick={clearFile}
                className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title="Remove uploaded bill"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className={`${buttonClass("primary")} shadow-sm flex items-center gap-2 px-4 py-2 text-xs font-semibold`}
          >
            <Camera aria-hidden="true" className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Reading supplier bill with AI…" : currentFile ? "Scan Another Bill" : "Scan / Upload Bill"}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <p className="font-semibold">Bill Reading Failed</p>
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
