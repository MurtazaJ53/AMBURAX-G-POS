import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM symmetric encryption for marketplace credentials (Flipkart client secrets, tokens).
 *
 * New secrets are encrypted only with the server secret AI_KEY_ENCRYPTION_KEY (at least 32
 * characters); without it nothing is stored. A key derived from DATABASE_URL or a constant in the
 * code would let anyone with the database login or this source decrypt every marketplace secret.
 * Secrets saved earlier under those derivations can still be read until they are saved again.
 */

export class EncryptionNotConfiguredError extends Error {
  constructor() {
    super("AI_KEY_ENCRYPTION_KEY (at least 32 characters) must be set before marketplace credentials can be stored.");
  }
}

function getSecretKey(): Buffer {
  const secret = process.env.AI_KEY_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) throw new EncryptionNotConfiguredError();
  return createHash("sha256").update(secret).digest();
}

function readKeys(): Buffer[] {
  const keys: Buffer[] = [];
  const s = process.env.AI_KEY_ENCRYPTION_KEY?.trim();
  if (s && s.length >= 32) keys.push(createHash("sha256").update(s).digest());
  for (const legacy of [process.env.DATABASE_URL?.trim(), "amburax-pos-commerce-secret-key-32b"]) {
    if (legacy) keys.push(createHash("sha256").update(legacy).digest());
  }
  return keys;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecretKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string | null {
  const [v, iv, tag, body] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !body) return null;
  for (const key of readKeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
    } catch {
      /* try the next key */
    }
  }
  return null;
}
