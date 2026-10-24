import { CODE128_PATTERNS } from "./code128Svg";

/**
 * Barcode symbologies for printed labels, as module strings ("1" bar, "0" space), without
 * quiet zones. The label decides how wide a module is in printer dots; this module only
 * decides which bars and spaces there are.
 *
 * Which symbology a value gets:
 *   - 13 digits with a valid check digit  -> EAN-13 (what every retail scanner reads by default)
 *   - any other all-digit value            -> Code 128 subset C (two digits per symbol, so
 *                                             half the width of subset B)
 *   - anything else in printable ASCII     -> Code 128 subset B
 * A 13-digit value whose check digit is wrong is not EAN-13: a scanner in EAN mode rejects it,
 * so it is drawn as Code 128-C and still reads back exactly.
 */

export type Symbology = "EAN13" | "CODE128C" | "CODE128B";

export type EncodedBarcode =
  | { ok: true; symbology: Symbology; modules: string }
  | { ok: false; reason: string };

const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const EAN_R = EAN_L.map((code) => code.replace(/[01]/g, (bit) => (bit === "0" ? "1" : "0")));
/** Left-half parity per leading digit: L = odd parity set, G = even parity set. */
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** GS1 mod-10 check digit for the first 12 digits of an EAN-13. */
export function ean13CheckDigit(twelveDigits: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(twelveDigits[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(value: string): boolean {
  return /^\d{13}$/.test(value) && ean13CheckDigit(value.slice(0, 12)) === Number(value[12]);
}

export function encodeEan13(value: string): string {
  if (!isValidEan13(value)) throw new Error(`Not a valid EAN-13: ${value}`);
  const parity = EAN_PARITY[Number(value[0])]!;
  let modules = "101";
  for (let i = 1; i <= 6; i++) {
    const digit = Number(value[i]);
    modules += parity[i - 1] === "L" ? EAN_L[digit] : EAN_G[digit];
  }
  modules += "01010";
  for (let i = 7; i <= 12; i++) modules += EAN_R[Number(value[i])];
  return modules + "101";
}

const CODE_B = 100;
const START_B = 104;
const START_C = 105;
const STOP = 106;

function code128Modules(values: number[]): string {
  let checksum = values[0]!;
  for (let i = 1; i < values.length; i++) checksum += values[i]! * i;
  let modules = "";
  for (const value of [...values, checksum % 103, STOP]) {
    let isBar = true;
    for (const width of CODE128_PATTERNS[value]!) {
      modules += (isBar ? "1" : "0").repeat(Number(width));
      isBar = !isBar;
    }
  }
  return modules;
}

/**
 * Code 128-C for an all-digit value. An odd-length value is encoded as pairs, then a switch
 * to subset B for the last digit — the same choice reference encoders make.
 */
export function encodeCode128C(digits: string): string {
  if (!/^\d+$/.test(digits)) throw new Error("Code 128-C takes digits only.");
  const values = [START_C];
  const pairsEnd = digits.length - (digits.length % 2);
  for (let i = 0; i < pairsEnd; i += 2) values.push(Number(digits.slice(i, i + 2)));
  if (pairsEnd < digits.length) {
    values.push(CODE_B, digits.charCodeAt(pairsEnd) - 32);
  }
  return code128Modules(values);
}

export function encodeCode128B(text: string): string {
  const values = [START_B];
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (char.length !== 1 || code < 32 || code > 126) {
      throw new Error(`Code 128-B cannot encode "${char}".`);
    }
    values.push(code - 32);
  }
  return code128Modules(values);
}

export function encodeForLabel(value: string): EncodedBarcode {
  const code = value.trim();
  if (code.length === 0) return { ok: false, reason: "No barcode." };
  if (isValidEan13(code)) return { ok: true, symbology: "EAN13", modules: encodeEan13(code) };
  if (/^\d+$/.test(code)) return { ok: true, symbology: "CODE128C", modules: encodeCode128C(code) };
  if (!/^[\x20-\x7e]+$/.test(code)) {
    return { ok: false, reason: "Contains characters a barcode cannot carry." };
  }
  return { ok: true, symbology: "CODE128B", modules: encodeCode128B(code) };
}

/** Minimum quiet zone either side, in modules. EAN-13's left zone is 11 by GS1; 10 is the floor. */
export function quietZoneModules(symbology: Symbology): number {
  return symbology === "EAN13" ? 11 : 10;
}
