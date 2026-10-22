"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * Format phone with privacy masking according to role policy (Screen C1 / 11)
 * E.g. Cashiers see "98XXXXXX10", while Store Managers and Owners see full numbers.
 */
export function formatMaskedPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const clean = phone.trim();
  if (clean.length < 6) return clean;
  // If clean starts with +91, preserve country prefix
  if (clean.startsWith("+91") && clean.length >= 13) {
    const main = clean.slice(3);
    return `+91 ${main.slice(0, 2)}XXXXXX${main.slice(-2)}`;
  }
  return `${clean.slice(0, 2)}XXXXXX${clean.slice(-2)}`;
}

export function CustomerPhoneCell({
  phone,
  canViewUnmasked,
}: {
  phone: string | null | undefined;
  canViewUnmasked: boolean;
}) {
  const [unmasked, setUnmasked] = useState(false);

  if (!phone) return <span className="text-tertiary">—</span>;

  const display = canViewUnmasked || unmasked ? phone : formatMaskedPhone(phone);

  return (
    <div className="inline-flex items-center gap-1.5 group">
      <span className="font-mono tabular-nums text-secondary">{display}</span>
      {!canViewUnmasked && (
        <button
          type="button"
          onClick={() => setUnmasked((v) => !v)}
          title={unmasked ? "Hide phone" : "Reveal full phone"}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-tertiary hover:text-primary rounded focus:opacity-100"
        >
          {unmasked ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}
