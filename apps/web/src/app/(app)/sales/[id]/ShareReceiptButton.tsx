"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";

export function ShareReceiptButton({
  billNumber,
  totalFormatted,
  storeName,
}: {
  billNumber: string;
  totalFormatted: string;
  storeName: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const shareUrl = typeof window !== "undefined" ? window.location.href : "";
    const shareData = {
      title: `Invoice #${billNumber} · ${storeName}`,
      text: `Tax Invoice #${billNumber} for ${totalFormatted} from ${storeName}`,
      url: shareUrl,
    };

    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // Fallback to clipboard if user dismissed or cancelled share sheet
      }
    }

    try {
      await navigator.clipboard.writeText(`${shareData.text}\n${shareUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Ignore clipboard write errors
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      className="amb-press inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-background-card px-4 text-[13px] font-medium text-secondary transition-colors hover:border-border-hover hover:bg-background-hover hover:text-primary print:hidden"
      title="Share digital receipt link"
    >
      {copied ? (
        <>
          <Check aria-hidden="true" className="h-4 w-4 text-emerald-600" />
          <span className="text-emerald-700 font-semibold">Link Copied!</span>
        </>
      ) : (
        <>
          <Share2 aria-hidden="true" className="h-4 w-4" />
          Share
        </>
      )}
    </button>
  );
}
