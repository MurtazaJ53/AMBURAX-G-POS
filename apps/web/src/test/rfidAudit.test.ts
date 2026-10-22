import { describe, it, expect } from "vitest";
import {
  isValidEpcHex,
  decodeSgtin96,
  RfidScanAccumulator,
  reconcileRfidStockAudit,
} from "@/server/inventory/rfidAudit";

describe("RFID Stock Audit Protocol Engine (Line 18)", () => {
  // Valid 24-char (96-bit) sample EPC
  const validEpc = "3034257BF400B7800004D2E5";

  it("validates 96-bit hexadecimal EPC strings", () => {
    expect(isValidEpcHex(validEpc)).toBe(true);
    expect(isValidEpcHex("3034257BF4")).toBe(false); // Too short
    expect(isValidEpcHex("3034257BF400B7800004D2EZ")).toBe(false); // Non-hex char Z
  });

  it("decodes SGTIN-96 into Company Prefix, Item Reference, and Serial", () => {
    const decoded = decodeSgtin96(validEpc);
    expect(decoded.epcHex).toBe(validEpc);
    expect(decoded.companyPrefix).toBeDefined();
    expect(decoded.itemReference).toBeDefined();
    expect(decoded.serialNumber).toBeDefined();
    expect(decoded.skuMatch?.startsWith("SKU-")).toBe(true);
  });

  it("deduplicates rapid RFID stream bursts in scan accumulator", () => {
    const acc = new RfidScanAccumulator();
    
    // Simulate reading the same tag 5 times rapidly as handheld wand sweeps past
    acc.ingest([
      { epcHex: validEpc, rssi: -62 },
      { epcHex: validEpc, rssi: -58 },
      { epcHex: validEpc, rssi: -55 },
      { epcHex: validEpc, rssi: -60 },
      { epcHex: validEpc, rssi: -65 },
    ]);

    expect(acc.size()).toBe(1); // Exactly 1 physical unit
    const unique = acc.getUniqueTags();
    expect(unique[0]?.readCount).toBe(5);
    expect(unique[0]?.rssi).toBe(-65);
  });

  it("reconciles physical scanned RFID tags against inventory balance", () => {
    const decoded = decodeSgtin96(validEpc);
    const sku = decoded.skuMatch || "SKU-000001";

    const scannedTags = [
      { epcHex: validEpc, rssi: -60, antennaPort: 1, readCount: 1, lastSeenAt: new Date().toISOString() },
    ];

    const expectedInventory = [
      { sku: sku, expectedQty: 2 }, // System expected 2, but we only found 1
    ];

    const audit = reconcileRfidStockAudit(scannedTags, expectedInventory);
    expect(audit.totalUniqueTagsScanned).toBe(1);
    expect(audit.expectedUnits).toBe(2);
    expect(audit.matchedUnits).toBe(1);
    expect(audit.missingUnits).toBe(1);
    expect(audit.discrepancies.length).toBe(1);
    expect(audit.discrepancies[0]?.difference).toBe(-1);
  });
});
