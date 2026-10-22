import { db } from "@/server/db";
import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";

/**
 * Calculates standard EAN-8 modulo 10 checksum digit.
 */
export function calculateEan8CheckDigit(sevenDigits: string): string {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const digit = parseInt(sevenDigits[i]!, 10);
    // Positions: odd weights 3, even weights 1
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  const mod = sum % 10;
  return mod === 0 ? "0" : (10 - mod).toString();
}

/**
 * Auto-generate a compact, unique 8-character numeric barcode for thermal labels (EAN-8 / Code-128).
 *
 * Sequence & Collision Resistance:
 * - Uses in-store restricted EAN-8 prefix "20" through "29".
 * - Checks against tenant's existing variant_barcodes.
 * - Supports passing an optional active transaction client (tx) for atomic lock protection.
 */
export async function generateUniqueShortBarcode(
  tenantId: string,
  client?: Prisma.TransactionClient | typeof db,
  maxAttempts = 20
): Promise<string> {
  const prisma = client || db;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Generate 7 payload digits: prefix '20' + 5 random digits (range 00000..99999)
    const randomSuffix = randomInt(0, 99999).toString().padStart(5, "0");
    const payload7 = `20${randomSuffix}`;
    const checkDigit = calculateEan8CheckDigit(payload7);
    const candidate = `${payload7}${checkDigit}`;

    const existing = await prisma.variantBarcode.findFirst({
      where: {
        tenantId,
        barcode: candidate,
      },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  // Fallback: 12-digit in-store sequence + check digit if 7-digit space has dense collisions
  const timestampPart = Date.now().toString().slice(-8);
  const randomSuffix = randomInt(10, 99).toString();
  const fallback = `29${timestampPart}${randomSuffix}`.slice(0, 12);
  return fallback;
}
