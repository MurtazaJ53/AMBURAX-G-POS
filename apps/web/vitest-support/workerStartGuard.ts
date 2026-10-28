import type { Reporter, TestModule, TestSpecification } from "vitest/node";

/**
 * Fails the run when a test file never ran.
 *
 * Under load a pool worker can time out while starting. Vitest then reports the error as
 * "unhandled", leaves the file out of the totals, and the summary still reads "N passed (N)",
 * so a run that silently skipped whole files looked green. This reporter turns both symptoms
 * into a non-zero exit:
 *   - any "Failed to start … worker" / "Timeout starting … runner" error;
 *   - fewer test modules finished than were scheduled at the start of the run.
 */

const WORKER_START_PATTERNS = [/Failed to start \S+ worker/i, /Timeout starting \S+ runner/i];

export interface RunProblemsInput {
  scheduledFiles: readonly string[];
  finishedFiles: readonly string[];
  unhandledErrorMessages: readonly string[];
}

/** Pure check, unit tested; returns human-readable problems (empty means the run is whole). */
export function findRunProblems(input: RunProblemsInput): string[] {
  const problems: string[] = [];
  const startFailures = input.unhandledErrorMessages.filter((m) => WORKER_START_PATTERNS.some((p) => p.test(m)));
  for (const message of startFailures) problems.push(`worker failed to start: ${message.split("\n")[0]}`);
  const finished = new Set(input.finishedFiles);
  const missing = input.scheduledFiles.filter((f) => !finished.has(f));
  if (missing.length > 0) {
    problems.push(
      `${missing.length} of ${input.scheduledFiles.length} scheduled test files did not run: ${missing.join(", ")}`,
    );
  }
  return problems;
}

function messageOf(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { message?: unknown; cause?: unknown };
    const own = typeof e.message === "string" ? e.message : String(error);
    return e.cause ? `${own}\n${messageOf(e.cause)}` : own;
  }
  return String(error);
}

export default class WorkerStartGuard implements Reporter {
  private scheduled: string[] = [];

  onTestRunStart(specifications: ReadonlyArray<TestSpecification>): void {
    this.scheduled = specifications.map((s) => s.moduleId);
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<unknown>, reason: string): void {
    if (reason === "interrupted") return;
    const problems = findRunProblems({
      scheduledFiles: this.scheduled,
      finishedFiles: testModules.map((m) => m.moduleId),
      unhandledErrorMessages: unhandledErrors.map(messageOf),
    });
    if (problems.length === 0) return;
    process.exitCode = 1;
    console.error(`\n[worker-start-guard] The run is NOT clean:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
  }
}
