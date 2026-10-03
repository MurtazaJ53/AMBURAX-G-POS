import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";

/**
 * Integration tests — these run against a REAL PostgreSQL.
 *
 * Deliberately a second config rather than a flag on the first. `vitest.config.ts` injects
 * a fake `DATABASE_URL` so that unit tests can import server modules without a database;
 * that fake value is exactly what must not be in scope here. Two configs means the two
 * suites cannot be accidentally cross-wired, and `npm test` stays fast and offline.
 *
 * Requires `docker compose up -d` and a migrated `amburax_test` database.
 * See DATABASE_SETUP.md.
 */

/**
 * Read `.env` directly. Vitest only exposes `VITE_`-prefixed variables by default, and the
 * database URL is deliberately not prefixed — it is server-only and must never be
 * bundle-visible.
 */
function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const appEnv = readEnvFile(path.resolve(import.meta.dirname, ".env"));

// Point at the dedicated test database, never at the development one. Integration tests
// truncate tables between cases, so aiming them at `amburax_identity` would silently wipe a
// developer's local data.
const baseUrl = process.env.DATABASE_URL ?? appEnv.DATABASE_URL ?? "";
const testUrl = baseUrl.replace(/\/amburax_identity(\?|$)/, "/amburax_test$1");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/test-integration/**/*.test.ts"],
    // Real database work is slower than pure logic, and the concurrency cases deliberately
    // block on row locks.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // A shared database cannot be truncated by several workers at once. One worker keeps
    // the fixtures deterministic; these suites are small enough that it costs nothing.
    //
    // isolate: false is critical: with pool:"forks" vitest still spawns a fresh fork per
    // file unless isolate is disabled, so teardown of file N briefly races with startup of
    // file N+1 — both holding or acquiring AccessExclusiveLock on the same tables through
    // TRUNCATE. Disabling isolation reuses the single long-lived worker across all files,
    // giving truly sequential, single-connection access to the test database.
    fileParallelism: false,
    isolate: false,
    pool: "forks",
    maxWorkers: 1,
    // No global teardown is registered, deliberately.
    //
    // There was a `globalTeardown: [...]` entry here. Vitest has no such option — it offers
    // `globalSetup`, whose module may export a `teardown`. The unknown key was ignored at
    // runtime, so the file it named never ran, and it failed `tsc` (TS2769), which is what made
    // `npm run typecheck` red.
    //
    // Nothing needs to replace it. What actually caused hangs was per-file `db.$disconnect()`
    // in `afterAll`: with `isolate: false` every file shares one process and one client, so the
    // first file to finish closed the pool out from under the rest and the next `beforeEach`
    // waited forever for a connection that would never be granted. Those calls are gone. The
    // worker owns the client for the whole run and the process tears it down on exit — and a
    // global teardown could not have helped regardless, since it runs in the main process and
    // would be disconnecting a different client instance from the worker's.
    env: {
      DATABASE_URL: testUrl,
    },
  },
});

