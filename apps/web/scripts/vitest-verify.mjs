#!/usr/bin/env node
/**
 * `npm run test:verify` — a unit run that only counts when it is whole.
 *
 * 1. Lists the test files with `vitest list --filesOnly --json`.
 * 2. Runs the suite with a JSON report next to the normal output.
 * 3. Fails (exit 1) unless: vitest exited 0, the files that ran equal the listed files,
 *    and no "Failed to start … worker" error appeared. Prints both numbers either way.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cwd = path.resolve(import.meta.dirname, "..");
const vitestBin = path.join(cwd, "node_modules", "vitest", "vitest.mjs");
const resolvedBin = (() => {
  try {
    readFileSync(vitestBin);
    return vitestBin;
  } catch {
    return path.resolve(cwd, "..", "..", "node_modules", "vitest", "vitest.mjs");
  }
})();
const extraArgs = process.argv.slice(2);
const norm = (f) => path.resolve(cwd, f).split(path.sep).join("/").toLowerCase();

const list = spawnSync(process.execPath, [resolvedBin, "list", "--filesOnly", "--json", ...extraArgs], {
  cwd,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (list.status !== 0) {
  process.stderr.write(list.stdout + list.stderr);
  console.error("[test:verify] `vitest list` failed");
  process.exit(1);
}
const listed = new Set(JSON.parse(list.stdout.slice(list.stdout.indexOf("["))).map((e) => norm(e.file)));

const dir = mkdtempSync(path.join(tmpdir(), "vitest-verify-"));
const reportFile = path.join(dir, "report.json");
const run = spawnSync(
  process.execPath,
  [
    resolvedBin,
    "run",
    "--reporter=default",
    "--reporter=./vitest-support/workerStartGuard.ts",
    "--reporter=json",
    `--outputFile.json=${reportFile}`,
    ...extraArgs,
  ],
  { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
);
process.stdout.write(run.stdout ?? "");
process.stderr.write(run.stderr ?? "");

const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
const workerStartErrors = (output.match(/Failed to start \S+ worker|Timeout starting \S+ runner/g) ?? []).length;
let ran = new Set();
let tests = { total: 0, passed: 0, failed: 0 };
try {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  ran = new Set(report.testResults.map((r) => norm(r.name)));
  tests = { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests };
} catch {
  console.error("[test:verify] no JSON report was written");
}
rmSync(dir, { recursive: true, force: true });

const missing = [...listed].filter((f) => !ran.has(f));
const unexpected = [...ran].filter((f) => !listed.has(f));
console.log(
  `\n[test:verify] files listed ${listed.size}, files ran ${ran.size}, worker-start errors ${workerStartErrors}, ` +
    `tests ${tests.passed}/${tests.total} passed (${tests.failed} failed), vitest exit ${run.status}`,
);
for (const f of missing) console.log(`  missing: ${f}`);
for (const f of unexpected) console.log(`  not listed: ${f}`);

const clean = run.status === 0 && missing.length === 0 && unexpected.length === 0 && workerStartErrors === 0;
console.log(clean ? "[test:verify] CLEAN" : "[test:verify] NOT CLEAN");
process.exit(clean ? 0 : 1);
