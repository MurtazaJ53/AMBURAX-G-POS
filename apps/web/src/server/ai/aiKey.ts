import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";

/**
 * The shop owner's own AI keys (Anthropic Claude and Google Gemini),
 * used for reading supplier bills, smart column matching on import, and AI summaries.
 *
 * Optional: everything works without it, only the "smart" features use it.
 * Stored AES-256-GCM encrypted with the server secret `AI_KEY_ENCRYPTION_KEY` (at least 32
 * characters). New keys are never encrypted with anything else: deriving the key from
 * DATABASE_URL would let anyone holding the database login decrypt them. Keys saved earlier with
 * that derivation can still be read (`legacyKey`) until they are saved again.
 * Only the last 4 characters are ever shown in the UI.
 */

function secretKey(): Buffer | null {
  const raw = process.env.AI_KEY_ENCRYPTION_KEY?.trim();
  if (!raw || raw.length < 32) return null;
  return createHash("sha256").update(raw).digest();
}

/** Read-only: keys stored before AI_KEY_ENCRYPTION_KEY was required were derived from DATABASE_URL. */
function legacyKey(): Buffer | null {
  const raw = process.env.DATABASE_URL?.trim();
  return raw ? createHash("sha256").update(raw).digest() : null;
}

function decryptStored(stored: string): string | null {
  for (const k of [secretKey(), legacyKey()]) {
    if (!k) continue;
    const plain = decrypt(stored, k);
    if (plain) return plain;
  }
  return null;
}

export function aiKeyStorageReady(): boolean {
  return secretKey() !== null;
}

function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

function decrypt(stored: string, key: Buffer): string | null {
  const [v, iv, tag, body] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export type SetAiKeyResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_configured" }
  | { status: "invalid"; reason: string };

/**
 * Save or clear Anthropic Claude key
 */
export async function setAiKey(input: {
  actor: { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };
  apiKey: string | null;
}): Promise<SetAiKeyResult> {
  if (input.actor.tenantRole !== "OWNER") return { status: "forbidden" };
  if (input.apiKey === null) {
    await db.tenant.update({ where: { id: input.actor.tenantId }, data: { aiKeyCipher: null, aiKeyLast4: null } });
  } else {
    const k = input.apiKey.trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) {
      return { status: "invalid", reason: "That doesn't look like an Anthropic API key (it starts with sk-ant-)." };
    }
    const secret = secretKey();
    if (!secret) return { status: "not_configured" };
    await db.tenant.update({
      where: { id: input.actor.tenantId },
      data: { aiKeyCipher: encrypt(k, secret), aiKeyLast4: k.slice(-4) },
    });
  }
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: input.apiKey === null ? "ai_key.cleared" : "ai_key.set",
    correlationId: randomUUID(),
  });
  return { status: "ok" };
}

/**
 * Save or clear Google Gemini key
 */
export async function setGeminiKey(input: {
  actor: { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };
  apiKey: string | null;
}): Promise<SetAiKeyResult> {
  if (input.actor.tenantRole !== "OWNER") return { status: "forbidden" };
  if (input.apiKey === null) {
    await db.tenant.update({ where: { id: input.actor.tenantId }, data: { geminiKeyCipher: null, geminiKeyLast4: null } });
  } else {
    const k = input.apiKey.trim();
    // Gemini keys usually start with AIzaSy or similar, 39 characters
    if (k.length < 25) {
      return { status: "invalid", reason: "Invalid Gemini API key format (usually 39 alphanumeric characters)." };
    }
    const secret = secretKey();
    if (!secret) return { status: "not_configured" };
    await db.tenant.update({
      where: { id: input.actor.tenantId },
      data: { geminiKeyCipher: encrypt(k, secret), geminiKeyLast4: k.slice(-4) },
    });
  }
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: input.apiKey === null ? "gemini_key.cleared" : "gemini_key.set",
    correlationId: randomUUID(),
  });
  return { status: "ok" };
}

/**
 * Save or clear OpenAI ChatGPT key
 */
export async function setOpenAiKey(input: {
  actor: { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };
  apiKey: string | null;
}): Promise<SetAiKeyResult> {
  if (input.actor.tenantRole !== "OWNER") return { status: "forbidden" };
  if (input.apiKey === null) {
    await db.tenant.update({ where: { id: input.actor.tenantId }, data: { openaiKeyCipher: null, openaiKeyLast4: null } });
  } else {
    const k = input.apiKey.trim();
    // OpenAI keys usually start with sk- or sk-proj- and are >= 25 characters
    if (!k.startsWith("sk-") || k.length < 25) {
      return { status: "invalid", reason: "Invalid OpenAI API key format (usually starts with sk- or sk-proj-)." };
    }
    const secret = secretKey();
    if (!secret) return { status: "not_configured" };
    await db.tenant.update({
      where: { id: input.actor.tenantId },
      data: { openaiKeyCipher: encrypt(k, secret), openaiKeyLast4: k.slice(-4) },
    });
  }
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: input.apiKey === null ? "openai_key.cleared" : "openai_key.set",
    correlationId: randomUUID(),
  });
  return { status: "ok" };
}

/**
 * Combined AI provider status for Anthropic, Gemini, and OpenAI
 */
export async function aiKeyStatus(tenantId: string): Promise<{
  set: boolean;
  last4: string | null;
  geminiSet: boolean;
  geminiLast4: string | null;
  openaiSet: boolean;
  openaiLast4: string | null;
  storageReady: boolean;
}> {
  const t = await db.tenant.findUnique({
    where: { id: tenantId },
    select: {
      aiKeyCipher: true,
      aiKeyLast4: true,
      geminiKeyCipher: true,
      geminiKeyLast4: true,
      openaiKeyCipher: true,
      openaiKeyLast4: true,
    },
  });
  return {
    set: Boolean(t?.aiKeyCipher),
    last4: t?.aiKeyLast4 ?? null,
    geminiSet: Boolean(t?.geminiKeyCipher),
    geminiLast4: t?.geminiKeyLast4 ?? null,
    openaiSet: Boolean(t?.openaiKeyCipher),
    openaiLast4: t?.openaiKeyLast4 ?? null,
    storageReady: aiKeyStorageReady(),
  };
}

/** The decrypted Anthropic key for a server-side AI call, or null when none is usable. */
export async function loadAiKey(tenantId: string): Promise<string | null> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { aiKeyCipher: true } });
  return t?.aiKeyCipher ? decryptStored(t.aiKeyCipher) : null;
}

/** The decrypted Google Gemini key for server-side AI calls, or null when none is usable. */
export async function loadGeminiKey(tenantId: string): Promise<string | null> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { geminiKeyCipher: true } });
  return t?.geminiKeyCipher ? decryptStored(t.geminiKeyCipher) : null;
}

/** The decrypted OpenAI ChatGPT key for server-side AI calls, or null when none is usable. */
export async function loadOpenAiKey(tenantId: string): Promise<string | null> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { openaiKeyCipher: true } });
  return t?.openaiKeyCipher ? decryptStored(t.openaiKeyCipher) : null;
}

/**
 * Resolves the active AI provider and key:
 * Priority: Google Gemini -> OpenAI ChatGPT -> Anthropic Claude.
 */
export async function resolveAnyAiKey(tenantId: string): Promise<
  | { provider: "gemini"; apiKey: string }
  | { provider: "openai"; apiKey: string }
  | { provider: "claude"; apiKey: string }
  | null
> {
  const geminiKey = await loadGeminiKey(tenantId);
  if (geminiKey) return { provider: "gemini", apiKey: geminiKey };

  const openaiKey = await loadOpenAiKey(tenantId);
  if (openaiKey) return { provider: "openai", apiKey: openaiKey };

  const claudeKey = await loadAiKey(tenantId);
  if (claudeKey) return { provider: "claude", apiKey: claudeKey };

  return null;
}
