import { describe, expect, it } from "vitest";
import { csvTextCell, istDateTime, minorToDecimal, SALES_CSV_HEADERS, toSalesCsv, UTF8_BOM, type SalesCsvRow } from "@/server/sales/salesCsv";

const ROW: SalesCsvRow = {
  billNumber: "MAIN-000123",
  completedAt: new Date("2026-10-12T06:30:05.000Z"), // 12:00:05 IST
  paymentMethod: "CASH + UPI",
  status: "COMPLETED",
  subtotalMinor: 95_238,
  taxMinor: 4_762,
  discountMinor: 1_234,
  totalMinor: 98_766,
  paidMinor: 98_766,
};

describe("toSalesCsv", () => {
  it("writes a UTF-8 BOM, the exact header row, and CRLF line endings", () => {
    const csv = toSalesCsv([]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toBe(`${UTF8_BOM}Bill Number,Date/Time (IST),Payment Method,Status,Subtotal,Tax,Discount,Total,Paid\r\n`);
    expect(SALES_CSV_HEADERS).toHaveLength(9);
  });

  it("writes stored values exactly, including the stored discount", () => {
    const [, line] = toSalesCsv([ROW]).slice(1).split("\r\n");
    expect(line).toBe("MAIN-000123,2026-10-12 12:00:05,CASH + UPI,COMPLETED,952.38,47.62,12.34,987.66,987.66");
  });

  it("has no customer, phone, or id columns", () => {
    const header = toSalesCsv([]).slice(1).split("\r\n")[0]!.toLowerCase();
    expect(header).not.toMatch(/customer|phone|\bid\b|tenant|store/);
  });

  it("leaves an empty payment method blank", () => {
    const [, line] = toSalesCsv([{ ...ROW, paymentMethod: null }]).slice(1).split("\r\n");
    expect(line!.split(",")[2]).toBe("");
  });
});

describe("csvTextCell", () => {
  it.each([
    ["plain", "plain"],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["line1\nline2", '"line1\nline2"'],
    ["line1\r\nline2", '"line1\r\nline2"'],
  ])("escapes %j as %j", (input, expected) => {
    expect(csvTextCell(input)).toBe(expected);
  });

  it.each(["=SUM(A1:A9)", "+1+1", "-2+3", "@cmd", "\t=1", "\r=1", '=HYPERLINK("http://x","y")'])(
    "neutralises a formula-leading value %j",
    (input) => {
      const cell = csvTextCell(input);
      const unquoted = cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
      expect(unquoted.startsWith("'")).toBe(true);
      expect(unquoted.slice(1)).toBe(input);
    },
  );

  it("neutralises a formula-leading bill number inside a full row", () => {
    const [, line] = toSalesCsv([{ ...ROW, billNumber: "=1+1" }]).slice(1).split("\r\n");
    expect(line!.startsWith("'=1+1,")).toBe(true);
  });
});

describe("amount and time formatting", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [100, "1.00"],
    [123_456, "1234.56"],
    [-500, "-5.00"],
  ])("minorToDecimal(%i) = %s", (minor, text) => {
    expect(minorToDecimal(minor)).toBe(text);
  });

  it("refuses a non-integer amount instead of rounding it", () => {
    expect(() => minorToDecimal(1.5)).toThrow();
  });

  it("prints IST across a UTC day boundary", () => {
    expect(istDateTime(new Date("2026-10-12T20:00:00.000Z"))).toBe("2026-10-13 01:30:00");
  });
});
