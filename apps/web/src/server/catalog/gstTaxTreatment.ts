import { GstTaxTreatment } from "@prisma/client";

export const GST_TAX_TREATMENTS = Object.values(GstTaxTreatment);

export interface GstClassification {
  taxTreatment: GstTaxTreatment;
  taxRateBp: number;
  taxExemptionRef: string | null;
}

/** Validate shape only; statutory eligibility is a reviewer/business decision. */
export function gstClassificationError(value: GstClassification): string | null {
  if (!Number.isInteger(value.taxRateBp) || value.taxRateBp < 0) {
    return "Tax rate must be a non-negative integer number of basis points.";
  }

  if (value.taxTreatment === GstTaxTreatment.TAXABLE && value.taxRateBp <= 0) {
    return "Taxable items require a positive tax rate.";
  }
  if (value.taxTreatment !== GstTaxTreatment.TAXABLE && value.taxRateBp !== 0) {
    return "Only taxable items may have a positive tax rate.";
  }

  const reference = value.taxExemptionRef?.trim() ?? "";
  if (value.taxTreatment === GstTaxTreatment.EXEMPT && reference.length === 0) {
    return "Exempt items require a statutory reference.";
  }
  if (value.taxTreatment !== GstTaxTreatment.EXEMPT && reference.length > 0) {
    return "A statutory exemption reference is only valid for exempt items.";
  }

  return null;
}

/** What a receipt prints instead of a GST amount for a non-taxable line; null for taxable/unknown. */
export function gstTypeLabel(treatment: string | null | undefined): string | null {
  switch (treatment) {
    case "EXEMPT":
      return "Exempt";
    case "NIL_RATED":
      return "Nil-rated";
    case "ZERO_RATED":
      return "Zero-rated";
    case "NON_GST":
      return "Non-GST";
    default:
      return null;
  }
}
