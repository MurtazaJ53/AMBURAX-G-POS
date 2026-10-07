"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Copy one value to the clipboard.
 *
 * Shows the tick only when the copy actually happened: `navigator.clipboard` is unavailable on
 * an insecure origin or without permission, and claiming a copy that did not happen is worse
 * than doing nothing — the value is on screen regardless.
 */
export function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access. Leave the icon unchanged.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={title}
      aria-label={title}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-tertiary transition-colors hover:bg-background-hover hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-focus print:hidden"
    >
      {copied ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-success" /> : <Copy aria-hidden="true" className="h-3.5 w-3.5" />}
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

