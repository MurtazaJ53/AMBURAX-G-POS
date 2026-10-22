import { db } from "@/server/db";
import { randomBytes, randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";

/**
 * Strict Code Sanitizer:
 * Restricts output strictly to uppercase alphanumeric characters and hyphens [A-Z0-9-].
 * Replaces spaces, slashes, underscores, and special characters with hyphens.
 * Collapses multiple consecutive hyphens into a single hyphen and trims boundary hyphens.
 */
export function sanitizeCleanCode(raw: string, maxLength = 32): string {
  if (!raw) return "";
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "-") // replace spaces & symbols with '-'
    .replace(/-+/g, "-")          // collapse repeated '-'
    .replace(/^-|-$/g, "");       // trim leading/trailing '-'

  return cleaned.slice(0, maxLength);
}

/**
 * Generates a clean, unique SKU conforming to:
 * - Uppercase [A-Z0-9-]
 * - Maximum 32 characters
 * - Collision checking against tenant's existing product_variants
 * - Retries on collision with fresh entropy suffix
 */
export async function generateCleanSku(params: {
  tenantId: string;
  productName: string;
  size?: string | null;
  colour?: string | null;
  client?: Prisma.TransactionClient | typeof db;
  maxAttempts?: number;
}): Promise<string> {
  const { tenantId, productName, size, colour, client, maxAttempts = 10 } = params;
  const prisma = client || db;

  const baseProd = sanitizeCleanCode(productName, 8) || "ITEM";
  const sizePart = size ? sanitizeCleanCode(size, 4) : null;
  const colPart = colour ? sanitizeCleanCode(colour, 4) : null;

  const prefixParts = [baseProd];
  if (sizePart) prefixParts.push(sizePart);
  if (colPart) prefixParts.push(colPart);
  const prefix = prefixParts.join("-");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 4-char cryptographic entropy suffix
    const suffix = randomBytes(2).toString("hex").toUpperCase();
    const candidate = sanitizeCleanCode(`${prefix}-${suffix}`, 32);

    const existing = await prisma.productVariant.findFirst({
      where: { tenantId, sku: candidate },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  // Fallback high-entropy candidate
  const fallbackSuffix = Date.now().toString(36).toUpperCase().slice(-6);
  return sanitizeCleanCode(`${prefix.slice(0, 24)}-${fallbackSuffix}`, 32);
}

/**
 * Calculates standard EAN-8 modulo 10 checksum digit.
 */
export function calculateEan8CheckDigit(sevenDigits: string): string {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const digit = parseInt(sevenDigits[i]!, 10);
    // Odd positions weighted 3, even weighted 1
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  const mod = sum % 10;
  return mod === 0 ? "0" : (10 - mod).toString();
}

/**
 * Generates a clean, unique Barcode:
 * - Strictly [A-Z0-9-]
 * - Barcodes must NOT contain product name text or spaces
 * - Defaults to standardized EAN-8 sequence (20xxxxxC) for in-store thermal labels
 * - Checks both product_variants.barcode AND variant_barcodes tables
 * - Retries on collision
 */
export async function generateCleanBarcode(params: {
  tenantId: string;
  client?: Prisma.TransactionClient | typeof db;
  maxAttempts?: number;
}): Promise<string> {
  const { tenantId, client, maxAttempts = 20 } = params;
  const prisma = client || db;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Standard thermal label EAN-8 prefix "20" + 5 random digits + checksum
    const randomSuffix = randomInt(0, 99999).toString().padStart(5, "0");
    const payload7 = `20${randomSuffix}`;
    const checkDigit = calculateEan8CheckDigit(payload7);
    const candidate = `${payload7}${checkDigit}`;

    // Verify against both variant_barcodes and product_variants
    const [inVariantBarcodes, inProductVariants] = await Promise.all([
      prisma.variantBarcode.findFirst({
        where: { tenantId, barcode: candidate },
        select: { id: true },
      }),
      prisma.productVariant.findFirst({
        where: { tenantId, barcode: candidate },
        select: { id: true },
      }),
    ]);

    if (!inVariantBarcodes && !inProductVariants) {
      return candidate;
    }
  }

  // Fallback 12-digit clean numeric string
  const timestampPart = Date.now().toString().slice(-8);
  const randomTail = randomInt(10, 99).toString();
  return sanitizeCleanCode(`29${timestampPart}${randomTail}`, 32);
}
