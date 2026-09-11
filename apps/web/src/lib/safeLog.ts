/**
 * Centralized server-side error logging that cannot leak credentials.
 *
 * Closes P0-2. Before this, 25 call sites logged the raw error object
 * (`console.error("[scope] failed", { correlationId, err })`). That is unsafe by
 * construction: an error's `message`, `stack` and enumerable properties are arbitrary
 * strings produced by libraries we do not control, and a connection string, bearer token
 * or API key inside any of them would be written verbatim to stdout.
 *
 * What the audit actually found, stated precisely rather than assumed:
 *
 *   - Prisma 5.22 *does* redact the password in its own error messages. Probed
 *     `PrismaClientInitializationError` for an unreachable server, an invalid scheme and a
 *     malformed port: none contained the password.
 *   - Prisma still echoes the *connection string and schema context* for configuration
 *     errors, which discloses host, port, database name and username.
 *   - Nothing guarantees this for non-Prisma errors. The `pg` driver, `fetch`, and every
 *     future adapter (ERPNext, payment providers, marketplaces) can and will put secrets
 *     in a message.
 *
 * So the defence is not "trust Prisma". It is: never hand an arbitrary error object to the
 * logger, and scrub whatever text we do keep.
 *
 * Deliberately NOT `console.error(err.message)` — the brief calls that out and it is
 * right: the message is exactly where a leaked secret would live.
 */

const REDACTED = "[redacted]";

/**
 * Literal values that must never appear in output, whatever they are embedded in.
 * Read once at module load. `DATABASE_URL` and its password component are the known
 * secrets in this process today; the list grows as real provider keys arrive.
 *
 * This is the belt-and-braces pass: even if every pattern below missed, an exact match on
 * the real secret is still caught.
 */
function knownSecrets(): string[] {
  const out: string[] = [];
  const url = process.env.DATABASE_URL;
  if (url && url.length > 0) {
    out.push(url);
    // The password component on its own — a library may print it without the surrounding URL.
    const match = /^[a-z][a-z0-9+.-]*:\/\/[^:/@]+:([^@]+)@/i.exec(url);
    const password = match?.[1];
    if (password && password.length >= 4) out.push(password);
  }
  // Longest first, so a substring never blanks out the longer match it belongs to.
  return out.sort((a, b) => b.length - a.length);
}

const SECRETS = knownSecrets();

/**
 * Order matters. Each rule narrows what survives to the next one.
 */
const PATTERNS: { re: RegExp; to: string }[] = [
  // scheme://user:pass@host  ->  scheme://[redacted]@host
  // Keeps host/port/database, which is the part that actually helps debugging, and drops
  // the credentials, which never do.
  { re: /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, to: `$1${REDACTED}@` },

  // Authorization / Bearer / Basic headers. Consumes the whole header value, not just the
  // first token. An earlier version used `\S+`, which turned "authorization: Bearer <token>"
  // into "authorization: [redacted] <token>" — it redacted the scheme name and left the
  // credential itself in the log. Caught by its own test.
  { re: /\b(authorization|proxy-authorization)\b\s*[:=]\s*[^\n\r,;}]+/gi, to: `$1: ${REDACTED}` },
  { re: /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, to: `$1 ${REDACTED}` },

  // Cookies and set-cookie in any casing.
  { re: /\b(set-cookie|cookie)\b\s*[:=]\s*[^\n\r;]+/gi, to: `$1: ${REDACTED}` },

  // key=value / "key": "value" where the key names a secret.
  {
    re: /\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|session|otp|pairing[_-]?code)\b(["']?\s*[:=]\s*["']?)([^\s,;&"'}\]]+)/gi,
    to: `$1$2${REDACTED}`,
  },

  // PEM blocks.
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, to: REDACTED },

  // Long opaque strings: our own tokens are 64-char sha256 hex or 32-byte hex; JWTs and
  // provider keys are long base64url. Anything this long and this random is not
  // debugging information worth keeping.
  { re: /\b[A-Fa-f0-9]{32,}\b/g, to: REDACTED },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, to: REDACTED },
  { re: /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}\b/g, to: REDACTED },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, to: REDACTED },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, to: REDACTED },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, to: REDACTED },
];

/** Scrub an arbitrary string. Safe on any input, never throws. */
export function sanitizeText(input: unknown): string {
  let text: string;
  try {
    text = typeof input === "string" ? input : String(input);
  } catch {
    return REDACTED;
  }

  // Exact known secrets first — cheapest and most certain.
  for (const secret of SECRETS) {
    if (secret && text.includes(secret)) text = text.split(secret).join(REDACTED);
  }

  for (const { re, to } of PATTERNS) {
    text = text.replace(re, to);
  }

  return text;
}

export interface SanitizedError {
  /** Constructor name, e.g. "PrismaClientInitializationError". Never contains data. */
  name: string;
  /** Prisma's `code`/`errorCode` where present — the genuinely useful triage field. */
  code?: string;
  /** Scrubbed message. */
  message: string;
  /** Scrubbed stack. Present only when a stack existed. */
  stack?: string;
}

/**
 * Reduce any thrown value to a structure that is safe to print.
 *
 * Only four fields survive, and every free-text one is scrubbed. Enumerable properties are
 * deliberately dropped wholesale: Prisma attaches `meta`, `clientVersion` and friends, and
 * other libraries attach request/response objects that have carried credentials in the past.
 * An allow-list of four fields is the only version of this that stays safe as dependencies
 * change underneath us.
 */
export function sanitizeError(err: unknown): SanitizedError {
  try {
    if (err instanceof Error) {
      const code =
        (err as { code?: unknown }).code ?? (err as { errorCode?: unknown }).errorCode;
      return {
        name: err.name || err.constructor?.name || "Error",
        ...(typeof code === "string" || typeof code === "number" ? { code: String(code) } : {}),
        message: sanitizeText(err.message),
        ...(err.stack ? { stack: sanitizeText(err.stack) } : {}),
      };
    }
    return { name: typeof err, message: sanitizeText(err) };
  } catch {
    // A getter on the error threw. Report that honestly rather than crashing the handler.
    return { name: "UnserializableError", message: REDACTED };
  }
}

/**
 * The single logging entry point for server error paths.
 *
 * `scope` is a static string the developer writes ("auth/login"). `context` carries
 * non-secret identifiers — correlation id, tenant id, step name. Its values are scrubbed
 * too, because "non-secret" is a promise made by whoever writes the call site, and this
 * function is the place that stops being true from mattering.
 */
export function logError(
  scope: string,
  err: unknown,
  context: Record<string, string | number | boolean | null | undefined> = {},
): void {
  const safeContext: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || value === null) continue;
    safeContext[key] = sanitizeText(value);
  }

  console.error(
    JSON.stringify({
      level: "error",
      scope,
      ...safeContext,
      error: sanitizeError(err),
    }),
  );
}
