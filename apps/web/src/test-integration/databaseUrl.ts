/**
 * Resolves and validates the database connection URL for integration tests.
 *
 * Guarantees that integration tests (which delete or truncate tables between runs)
 * can ONLY ever execute against the dedicated 'amburax_test' database.
 */

export function resolveIntegrationDatabaseUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl || typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new Error(
      "DATABASE_URL is missing or empty. Integration tests require a valid PostgreSQL connection string targeting 'amburax_test'."
    );
  }

  // Preserve the existing /amburax_identity to /amburax_test rewrite
  const rewritten = rawUrl.replace(/\/amburax_identity(\?|$)/, "/amburax_test$1");

  let parsed: URL;
  try {
    parsed = new URL(rewritten);
  } catch {
    throw new Error(
      "DATABASE_URL is malformed. Integration tests require a valid PostgreSQL connection URL."
    );
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(
      "DATABASE_URL must use 'postgresql:' or 'postgres:' protocol."
    );
  }

  // Extract database name from pathname: "/amburax_test" -> "amburax_test"
  const dbName = parsed.pathname.replace(/^\//, "");

  if (dbName !== "amburax_test") {
    const targetDesc = dbName ? `'${dbName}'` : "unspecified";
    throw new Error(
      `Integration tests can only target the 'amburax_test' database, but the resolved target database is ${targetDesc}.`
    );
  }

  return rewritten;
}
