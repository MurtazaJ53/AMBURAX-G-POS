import { describe, expect, it } from "vitest";
import { GstTaxTreatment } from "@prisma/client";
import { gstClassificationError } from "@/server/catalog/gstTaxTreatment";

describe("GST classification validation", () => {
  it("accepts a taxable item with a positive integer rate", () => {
    expect(gstClassificationError({
      taxTreatment: GstTaxTreatment.TAXABLE,
      taxRateBp: 500,
      taxExemptionRef: null,
    })).toBeNull();
  });

  it("requires an explicit reference for exempt items", () => {
    expect(gstClassificationError({
      taxTreatment: GstTaxTreatment.EXEMPT,
      taxRateBp: 0,
      taxExemptionRef: null,
    })).toMatch(/statutory reference/i);
  });

  it.each([
    GstTaxTreatment.NIL_RATED,
    GstTaxTreatment.ZERO_RATED,
    GstTaxTreatment.NON_GST,
    GstTaxTreatment.UNSPECIFIED,
  ])("accepts %s only with a zero configured rate", (taxTreatment) => {
    expect(gstClassificationError({ taxTreatment, taxRateBp: 0, taxExemptionRef: null })).toBeNull();
    expect(gstClassificationError({ taxTreatment, taxRateBp: 500, taxExemptionRef: null })).toMatch(/only taxable/i);
  });

  it("rejects a zero-rate item marked taxable", () => {
    expect(gstClassificationError({
      taxTreatment: GstTaxTreatment.TAXABLE,
      taxRateBp: 0,
      taxExemptionRef: null,
    })).toMatch(/positive tax rate/i);
  });
});
