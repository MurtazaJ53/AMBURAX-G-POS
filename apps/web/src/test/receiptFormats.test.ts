import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { TaxInvoiceA4View } from "@/client/hardware/TaxInvoiceA4View";
import type { ReceiptData } from "@/client/hardware/escpos";

describe("Receipts Formats (TaxInvoiceA4View & ESC/POS)", () => {
  const baseReceipt: ReceiptData = {
    storeName: "Test Trendz Store",
    storeAddress: "123 MG Road, Bangalore",
    storePhone: "9876543210",
    storeState: "Karnataka",
    storeStateCode: "29",
    billNumber: "BL-TEST-1001",
    date: new Date("2026-10-23T12:00:00Z"),
    cashierName: "John Doe",
    terminalName: "Terminal 1",
    customerName: "Jane Smith",
    items: [
      {
        name: "Casual Shirt",
        variant: "M / Blue",
        sku: "SHIRT-M-BLU",
        quantity: 1,
        unitPriceMinor: 105000,
        gstRateBp: 500,
        totalMinor: 105000,
        hsn: "6205",
      },
      {
        name: "Plain Socks",
        variant: "Free",
        sku: "SOCK-01",
        quantity: 2,
        unitPriceMinor: 10000,
        totalMinor: 20000,
        // No HSN
      },
    ],
    subtotalMinor: 120000,
    totalMinor: 125000,
    payments: [{ method: "Cash", amountMinor: 125000 }],
  };

  describe("TaxInvoiceA4View Component", () => {
    it("renders TAX INVOICE with GSTIN, HSN, Taxable Val, and HSN Tax Summary table when GSTIN present", () => {
      const gstReceipt: ReceiptData = {
        ...baseReceipt,
        storeGstin: "29AABCU9603R1ZM",
      };

      const html = renderToString(React.createElement(TaxInvoiceA4View, { receiptData: gstReceipt }));

      expect(html).toContain("TAX INVOICE");
      expect(html).not.toContain("BILL OF SUPPLY");
      expect(html).toContain("29AABCU9603R1ZM");
      expect(html).toContain("Statutory HSN / SAC Tax Summary");
      expect(html).toContain("Taxable Val");
      expect(html).toContain("GST %");
      // HSN 6205 should be printed for shirt, and "-" or no 6203 fallback for socks
      expect(html).toContain("6205");
      expect(html).not.toContain("6203");
    });

    it("renders BILL OF SUPPLY without GSTIN or GST breakdown table when GSTIN absent", () => {
      const nonGstReceipt: ReceiptData = {
        ...baseReceipt,
        storeGstin: null,
      };

      const html = renderToString(React.createElement(TaxInvoiceA4View, { receiptData: nonGstReceipt }));

      expect(html).toContain("BILL OF SUPPLY");
      expect(html).not.toContain("TAX INVOICE");
      expect(html).not.toContain("29AABCU9603R1ZM");
      expect(html).not.toContain("Statutory HSN / SAC Tax Summary");
      expect(html).not.toContain("GST %");
      expect(html).not.toContain("Taxable Val");
      expect(html).not.toContain("6203");
    });
  });
});
