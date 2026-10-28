import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { taxRateModeLabel, taxTreatmentLabel } from "@/lib/taxWording";

// Bug 35: internal enums ("APPAREL_SLAB", "FIXED Rate", "NON_GST") were shown to shop owners.

describe("tax wording (bug 35)", () => {
  it("names tax modes and treatments in plain words", () => {
    expect(taxRateModeLabel("APPAREL_SLAB")).toBe("Garment slab (5% up to ₹2,500, 18% above)");
    expect(taxRateModeLabel("FIXED")).toBe("Fixed rate");
    expect(taxTreatmentLabel("TAXABLE")).toBe("Taxable");
    expect(taxTreatmentLabel("NON_GST")).toBe("Non-GST");
    expect(taxTreatmentLabel("SOMETHING_NEW")).toBe("Something new");
  });

  it.each([
    "src/app/(app)/products/new/AddProductWizard.tsx",
    "src/app/(app)/products/[id]/edit/ProductEditor.tsx",
    "src/components/catalog/ProductDetailPanel.tsx",
  ])("%s shows no raw tax enum", (file) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    expect(src).not.toMatch(/>APPAREL_SLAB|FIXED Rate|value=\{firstVariant\?\.tax(RateMode|Treatment) \|\|/);
  });
});
