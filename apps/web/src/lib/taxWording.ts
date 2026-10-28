/** Plain words for the tax enums stored on a variant, for screens a shop owner reads. */

export function taxRateModeLabel(mode: string | null | undefined): string {
  if (mode === "APPAREL_SLAB") return "Garment slab (5% up to ₹2,500, 18% above)";
  return "Fixed rate";
}

const TREATMENTS: Record<string, string> = {
  TAXABLE: "Taxable",
  NON_GST: "Non-GST",
  NIL_RATED: "Nil-rated",
  ZERO_RATED: "Zero-rated",
  EXEMPT: "Exempt",
};

export function taxTreatmentLabel(treatment: string | null | undefined): string {
  const t = treatment || "TAXABLE";
  if (TREATMENTS[t]) return TREATMENTS[t];
  const words = t.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
