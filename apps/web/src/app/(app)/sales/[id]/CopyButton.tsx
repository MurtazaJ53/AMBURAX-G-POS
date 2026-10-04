"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="text-slate-400 hover:text-blue-600 transition-colors"
      title={title}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}
