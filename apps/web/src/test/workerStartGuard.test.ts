import { describe, expect, it } from "vitest";
import { findRunProblems } from "../../vitest-support/workerStartGuard";

describe("worker-start guard", () => {
  it("passes a whole run", () => {
    expect(
      findRunProblems({ scheduledFiles: ["a", "b"], finishedFiles: ["b", "a"], unhandledErrorMessages: [] }),
    ).toEqual([]);
  });

  it("fails a run where a worker failed to start", () => {
    const problems = findRunProblems({
      scheduledFiles: ["a", "b"],
      finishedFiles: ["a"],
      unhandledErrorMessages: [
        "[vitest-pool]: Failed to start forks worker for test files b.\n[vitest-pool-runner]: Timeout waiting for worker to respond",
      ],
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/worker failed to start/);
    expect(problems[1]).toMatch(/1 of 2 scheduled test files did not run: b/);
  });

  it("fails on a start timeout even if every file is somehow accounted for", () => {
    expect(
      findRunProblems({
        scheduledFiles: ["a"],
        finishedFiles: ["a"],
        unhandledErrorMessages: ["[vitest-pool]: Timeout starting forks runner."],
      }),
    ).toHaveLength(1);
  });
});
