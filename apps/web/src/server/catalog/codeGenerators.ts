import { db } from "@/server/db";
import { randomBytes } from "node:crypto";
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
