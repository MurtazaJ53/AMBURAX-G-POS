import { describe, it, expect } from "vitest";
import {
  computeIrn,
  getFinancialYear,
  generateSignedQrPayload,
  requiresEwayBill,
  buildEInvoicePayload,
  generateEInvoiceAndEwayBill,
} from "@/server/erp/eInvoice";

describe("E-Invoice & E-Way Bill Engine (Line 7)", () => {
  it("computes standard 64-char hex SHA-256 IRN deterministically", () => {
    const irn1 = computeIrn("24AABCA1234F1Z5", "2026-27", "INV", "INV-2026-001");
    const irn2 = computeIrn("24AABCA1234F1Z5", "2026-27", "INV", "INV-2026-001");
    expect(irn1).toBe(irn2);
    expect(irn1.length).toBe(64);
    expect(/^[A-F0-9]{64}$/.test(irn1)).toBe(true);
  });

  it("calculates current financial year correctly", () => {
    const octDate = new Date(2026, 9, 18); // Oct 2026
    expect(getFinancialYear(octDate)).toBe("2026-27");
    const febDate = new Date(2027, 1, 10); // Feb 2027
    expect(getFinancialYear(febDate)).toBe("2026-27");
  });

  it("detects when consignment requires E-Way Bill (threshold >= ₹50,000)", () => {
    expect(requiresEwayBill(4999900, "24")).toBe(false); // ₹49,999
    expect(requiresEwayBill(5000000, "24")).toBe(true);  // ₹50,000 exactly
    expect(requiresEwayBill(12500000, "24")).toBe(true); // ₹1,25,000
  });

  it("builds valid E-Invoice payload and computes signed QR", async () => {
    const payload = buildEInvoicePayload({
      docNumber: "INV-2026-089",
      docDate: new Date(2026, 9, 18),
      seller: {
        gstin: "24AABCT1332L1ZV",
        legalName: "AMBURAX APPARELS PVT LTD",
        addressLine1: "Ring Road Market",
        location: "Surat",
        pincode: 395002,
        stateCode: "24",
      },
      buyer: {
        gstin: "27AAACR4839M1ZZ",
        legalName: "MUMBAI TEXTILE TRADERS",
        addressLine1: "Kalbadevi",
        location: "Mumbai",
        pincode: 400002,
        stateCode: "27",
      },
      lines: [
        {
          description: "Cotton Formal Shirt 40 M",
          hsnCode: "6205",
          quantity: 100,
          unitPriceMinor: 80000, // ₹800 each
          discountMinor: 0,
          taxableMinor: 8000000, // ₹80,000
          gstRateBp: 500, // 5% IGST interstate
          cgstMinor: 0,
          sgstMinor: 0,
          igstMinor: 400000, // ₹4,000
          totalMinor: 8400000, // ₹84,000
        },
      ],
      transport: {
        distanceKm: 280,
        transportMode: "ROAD",
        vehicleNumber: "GJ05XX1234",
        transporterName: "VRL Logistics",
      },
    });

    expect(payload.itemList.length).toBe(1);
    expect(payload.valDetails.totalInvoiceValueMinor).toBe(8400000);

    const result = await generateEInvoiceAndEwayBill(payload);
    expect(result.status).toBe("GENERATED");
    expect(result.irn.length).toBe(64);
    expect(result.ackNumber).toBeDefined();
    expect(result.signedQrCode).toContain("SGSTIN:24AABCT1332L1ZV");
    expect(result.signedQrCode).toContain("BGSTIN:27AAACR4839M1ZZ");
    expect(result.signedQrCode).toContain("HSN:6205");
    // Consignment value is ₹84,000 (> ₹50,000) so E-way bill is auto-generated
    expect(result.ewayBillNumber).toBeDefined();
    expect(result.ewayBillNumber?.length).toBe(12);
  });
});
