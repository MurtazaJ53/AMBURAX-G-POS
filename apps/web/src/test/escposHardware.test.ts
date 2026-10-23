import { describe, it, expect } from "vitest";
import { EscPosBuilder, generateEscPosReceipt, type ReceiptData } from "@/client/hardware/escpos";

describe("Hardware & ESC/POS Thermal Printing Suite", () => {
  const mockReceipt: ReceiptData = {
    storeName: "AMBURAX RETAIL STORE",
    storeAddress: "123 Commercial Street, Bangalore, Karnataka",
    storeGstin: "29AAAAA0000A1Z5",
    storePhone: "9876543210",
    billNumber: "BL-2026-0042",
    date: new Date("2026-10-18T10:30:00Z"),
    cashierName: "Priya Sharma",
    terminalName: "POS Terminal 1",
    customerName: "Rahul Verma",
    customerPhone: "9876543210",
    items: [
      {
        name: "Classic Cotton T-Shirt",
        variant: "L / Navy Blue",
        sku: "TS-NAVY-L",
        quantity: 2,
        unitPriceMinor: 49900,
        gstRateBp: 500,
        totalMinor: 99800,
      },
      {
        name: "Slim Fit Chinos",
        variant: "32 / Khaki",
        sku: "CH-KHAKI-32",
        quantity: 1,
        unitPriceMinor: 129900,
        gstRateBp: 1200,
        totalMinor: 129900,
      },
    ],
    subtotalMinor: 229700,
    discountMinor: 20000,
    cgstMinor: 5240,
    sgstMinor: 5240,
    totalMinor: 209700,
    payments: [
      {
        method: "UPI",
        amountMinor: 209700,
        reference: "UPI/32948291039",
      },
    ],
    footerMessage: "Thank you for shopping with us! Exchange valid for 7 days.",
  };

  it("builds valid ESC/POS commands with cash drawer kick and cutter", () => {
    const builder = new EscPosBuilder("80mm");
    builder
      .align("center")
      .bold(true)
      .size(2, 2)
      .line("AMBURAX POS")
      .bold(false)
      .align("left")
      .line("Bill: BL-001")
      .kickDrawer()
      .cut(true);

    const buffer = builder.build();
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(10);
    // Verifies ESC @ init command is at beginning
    expect(buffer[0]).toBe(0x1b);
    expect(buffer[1]).toBe(0x40);
  });

  it("generates 80mm binary ESC/POS payload matching receipt items and totals", () => {
    const payload80 = generateEscPosReceipt(mockReceipt, "80mm");
    expect(payload80).toBeInstanceOf(Uint8Array);
    expect(payload80.length).toBeGreaterThan(100);

    const textRepresentation = new TextDecoder().decode(payload80);
    expect(textRepresentation).toContain("AMBURAX RETAIL STORE");
    expect(textRepresentation).toContain("BL-2026-0042");
    expect(textRepresentation).toContain("Priya Sharma");
    expect(textRepresentation).toContain("Classic Cotton T-Shirt");
    expect(textRepresentation).toContain("Slim Fit Chinos");
    expect(textRepresentation).toContain("2,097.00");
  });

  it("formats exact paise correctly on receipts with fractional amounts", () => {
    const receiptWithPaise = {
      ...mockReceipt,
      totalMinor: 209750,
      payments: [
        { method: "Cash", amountMinor: 209750 },
      ],
    };
    const payload = generateEscPosReceipt(receiptWithPaise, "80mm");
    const text = new TextDecoder().decode(payload);
    expect(text).toContain("2,097.50");
  });

  it("generates compact 58mm roll format without throwing", () => {
    const payload58 = generateEscPosReceipt(mockReceipt, "58mm");
    expect(payload58).toBeInstanceOf(Uint8Array);
    expect(payload58.length).toBeGreaterThan(100);
    // 58mm uses narrower character width
    const textRepresentation = new TextDecoder().decode(payload58);
    expect(textRepresentation).toContain("BL-2026-0042");
  });

  describe("Non-GST vs GST receipts", () => {
    it("prints TAX INVOICE and GSTIN when store has GSTIN", () => {
      const payload = generateEscPosReceipt(mockReceipt, "80mm");
      const text = new TextDecoder().decode(payload);
      expect(text).toContain("TAX INVOICE");
      expect(text).toContain("GSTIN: 29AAAAA0000A1Z5");
      expect(text).toContain("CGST");
      expect(text).toContain("SGST");
    });

    it("prints BILL OF SUPPLY and omits GSTIN and tax breakup when store has no GSTIN", () => {
      const nonGstReceipt: ReceiptData = {
        ...mockReceipt,
        storeGstin: null,
        cgstMinor: 0,
        sgstMinor: 0,
        igstMinor: 0,
        items: [
          {
            name: "Classic Cotton T-Shirt",
            variant: "L / Navy Blue",
            quantity: 1,
            unitPriceMinor: 50000,
            totalMinor: 50000,
            hsn: "6203", // Even if product has HSN, non-GST receipt does not print HSN/GST
          },
        ],
      };

      const payload = generateEscPosReceipt(nonGstReceipt, "80mm");
      const text = new TextDecoder().decode(payload);
      expect(text).toContain("BILL OF SUPPLY");
      expect(text).not.toContain("TAX INVOICE");
      expect(text).not.toContain("GSTIN:");
      expect(text).not.toContain("CGST");
      expect(text).not.toContain("SGST");
      expect(text).not.toContain("IGST");
    });
  });
});
