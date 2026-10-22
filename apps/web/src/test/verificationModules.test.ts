import { describe, it, expect } from "vitest";
import {
  buildPineLabsTransactionPayload,
  parseEdcMachineResponse,
} from "@/server/pos/edcDriver";
import {
  computeFileChecksum,
  uploadDatabaseBackupToCloud,
} from "@/server/ops/cloudBackup";
import { profileDeviceHardware } from "@/lib/lowEndProfiler";

describe("Needs Verification Audit Suite (Lines 64, 68, 73)", () => {
  // Line 64: EDC Machine
  it("Line 64: builds Plutus/PineLabs card sale payload and parses successful swipe/tap response", () => {
    const payload = buildPineLabsTransactionPayload(
      {
        billNumber: "BILL-2026-901",
        amountMinor: 249900, // ₹2,499
        terminalId: "EDC_TID_1",
        cashierId: "usr_cashier",
      },
      {
        merchantId: "MERCHANT_99",
        terminalId: "EDC_TID_1",
      }
    ) as any;

    expect(payload.Detail.Amount).toBe("2499.00");
    expect(payload.Detail.BillingRefNo).toBe("BILL-2026-901");

    // Parse EDC machine response
    const edcResponse = parseEdcMachineResponse({
      ResponseCode: "00", // Success
      ResponseMessage: "APPROVED",
      RRN: "123456789012",
      ApprovalCode: "APP990",
      CardType: "Visa",
      CardNumber: "411111XXXXXX1234",
      Amount: "2499.00",
    });

    expect(edcResponse.status).toBe("APPROVED");
    expect(edcResponse.rrn).toBe("123456789012");
    expect(edcResponse.cardLast4).toBe("1234");
    expect(edcResponse.cardType).toBe("VISA");
  });

  // Line 68: Cloud Offsite Backup
  it("Line 68: calculates SHA-256 archive checksum and validates offsite replication dispatch", async () => {
    const dummyBackup = Buffer.from("DUMMY_POSTGRES_PG_DUMP_BINARY_DATA");
    const checksum = computeFileChecksum(dummyBackup);
    expect(checksum.length).toBe(64);

    const result = await uploadDatabaseBackupToCloud(
      dummyBackup,
      "amburax_backup_20261019.dump",
      {
        provider: "AWS_S3",
        bucketName: "amburax-pos-backups-secure",
        region: "ap-south-1",
        retentionDays: 30,
      }
    );

    expect(result.status).toBe("UPLOADED_VERIFIED");
    expect(result.sha256Checksum).toBe(checksum);
    expect(result.destinationBucket).toBe("amburax-pos-backups-secure");
    expect(result.cloudStorageKey).toContain("amburax_backup_20261019.dump");
  });

  // Line 73: Low-End Hardware Profiler
  it("Line 73: detects low-spec hardware (Celeron / 2GB RAM) and applies memory-sparing constraints", () => {
    // Low-end machine: 2 cores, 2GB RAM
    const lowEnd = profileDeviceHardware({
      hardwareConcurrency: 2,
      deviceMemoryGb: 2,
      memoryUsageMb: 75,
    });

    expect(lowEnd.isLowEndHardware).toBe(true);
    expect(lowEnd.recommendedSettings.disableAnimations).toBe(true);
    expect(lowEnd.recommendedSettings.virtualizedListThreshold).toBe(30);

    // Modern POS machine: 8 cores, 8GB RAM
    const highEnd = profileDeviceHardware({
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      memoryUsageMb: 120,
    });

    expect(highEnd.isLowEndHardware).toBe(false);
    expect(highEnd.recommendedSettings.disableAnimations).toBe(false);
  });
});
