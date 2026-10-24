import { describe, it, expect } from "vitest";
import {
  ean13CheckDigit,
  encodeCode128B,
  encodeCode128C,
  encodeEan13,
  encodeForLabel,
  isValidEan13,
} from "@/client/hardware/barcodeSymbology";
import { LABEL_SIZES, layoutLabelBarcode, moduleWidthMm, pageRule } from "@/client/hardware/labelLayout";

/**
 * Reference module strings were produced by an independent encoder (zxing-cpp's writer,
 * quiet zones off) and decoded back by zxing. If one of these changes, the printed bars changed.
 */
const REF = {
  ean13_4006381333931:
    "10100011010100111010111101111010001001011001101010100001010000101000010111010010000101100110101",
  ean13_2000000000015:
    "10100011010001101010011101001110001101010011101010111001011100101110010111001011001101001110101",
  c128c_12345678: "1101001110010110011100100010110001110001011011000010100100011101101100011101011",
  c128c_20123451: "1101001110011001001110101100111001000101100011011101000101100011101100011101011",
  c128c_123456789:
    "11010011100101100111001000101100011100010110110000101001011110111011100101100100011110101100011101011",
  c128b_bc4ws:
    "110100100001000101100010001000110100110111001100100111011011001100111010001101001101110011011101000111011011101100011101011",
};

describe("EAN-13", () => {
  it("computes the GS1 check digit", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
    expect(ean13CheckDigit("200000000001")).toBe(5);
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("4006381333932")).toBe(false);
  });

  it("matches the reference encoder", () => {
    expect(encodeEan13("4006381333931")).toBe(REF.ean13_4006381333931);
    expect(encodeEan13("2000000000015")).toBe(REF.ean13_2000000000015);
  });

  it("is always 95 modules", () => {
    expect(encodeEan13("8901234000021")).toHaveLength(95);
  });

  it("refuses a wrong check digit", () => {
    expect(() => encodeEan13("4006381333932")).toThrow();
  });
});

describe("Code 128", () => {
  it("encodes even-length digits in subset C like the reference", () => {
    expect(encodeCode128C("12345678")).toBe(REF.c128c_12345678);
    expect(encodeCode128C("20123451")).toBe(REF.c128c_20123451);
  });

  it("encodes odd-length digits as pairs then the last digit in subset B, like the reference", () => {
    expect(encodeCode128C("123456789")).toBe(REF.c128c_123456789);
  });

  it("encodes text in subset B like the reference", () => {
    expect(encodeCode128B("BC-4 W-S")).toBe(REF.c128b_bc4ws);
  });

  it("refuses characters outside printable ASCII instead of dropping them", () => {
    expect(() => encodeCode128B("KURTA₹")).toThrow();
    expect(encodeForLabel("KURTA₹")).toMatchObject({ ok: false });
  });
});

describe("symbology choice", () => {
  it("uses EAN-13 only for a valid 13-digit code", () => {
    expect(encodeForLabel("4006381333931")).toMatchObject({ ok: true, symbology: "EAN13" });
    expect(encodeForLabel("8901234000027")).toMatchObject({ ok: true, symbology: "CODE128C" });
  });

  it("uses Code 128-C for other digits and Code 128-B for text", () => {
    expect(encodeForLabel("20123451")).toMatchObject({ ok: true, symbology: "CODE128C" });
    expect(encodeForLabel("SKU-1")).toMatchObject({ ok: true, symbology: "CODE128B" });
    expect(encodeForLabel("  ")).toMatchObject({ ok: false });
  });
});

describe("label layout", () => {
  const roll50 = LABEL_SIZES["roll-50x25"];

  it("keeps the bar width fixed in printer dots whatever the code length", () => {
    const short = layoutLabelBarcode("20123451", roll50, 203);
    const long = layoutLabelBarcode("4006381333931", roll50, 203);
    expect(short.ok && long.ok).toBe(true);
    if (!short.ok || !long.ok) return;
    expect(short.moduleWidthMm).toBe(long.moduleWidthMm);
    expect(short.moduleWidthMm).toBeCloseTo((2 * 25.4) / 203, 6);
    expect(long.totalWidthMm).toBeGreaterThan(short.totalWidthMm);
  });

  it("uses whole dots per module at both resolutions", () => {
    expect(moduleWidthMm(203) * (203 / 25.4)).toBeCloseTo(2, 9);
    expect(moduleWidthMm(300) * (300 / 25.4)).toBeCloseTo(3, 9);
  });

  it("includes a quiet zone of at least 10 modules each side", () => {
    const layout = layoutLabelBarcode("12345678", roll50, 203);
    expect(layout.ok).toBe(true);
    if (!layout.ok) return;
    expect(layout.quietZoneModules).toBeGreaterThanOrEqual(10);
    expect(layout.totalWidthMm).toBeCloseTo((layout.modules.length + 2 * layout.quietZoneModules) * layout.moduleWidthMm, 9);
  });

  it("fits an EAN-13 on every size at 203 and 300 dpi", () => {
    for (const size of Object.values(LABEL_SIZES)) {
      for (const dpi of [203, 300] as const) {
        expect(layoutLabelBarcode("4006381333931", size, dpi).ok).toBe(true);
      }
    }
  });

  it("refuses a code too long for the label rather than shrinking it", () => {
    const result = layoutLabelBarcode("BC-4 W-S-BLA-7184", LABEL_SIZES["roll-38x25"], 203);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toMatch(/Too long for a 38 mm label/);
  });

  it("sets the printed page to the label size, or A4 for sheets", () => {
    expect(pageRule(roll50)).toBe("@page { size: 50mm 25mm; margin: 0; }");
    expect(pageRule(LABEL_SIZES["roll-38x25"])).toBe("@page { size: 38mm 25mm; margin: 0; }");
    expect(pageRule(LABEL_SIZES["a4-65"])).toBe("@page { size: 210mm 297mm; margin: 0; }");
  });
});
