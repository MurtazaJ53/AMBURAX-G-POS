import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Bug 40: one-off scripts, build logs and screenshots piled up at the root of apps/web.
 * Only project configuration belongs there; anything else goes under scripts/ or nowhere.
 */
const ALLOWED = new Set([
  ".env.example",
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
  "F8-FINAL-REPORT.md",
  "README.md",
  "eslint.config.mjs",
  "next-env.d.ts",
  "next.config.mjs",
  "package.json",
  "playwright.config.ts",
  "postcss.config.mjs",
  "tailwind.config.ts",
  "tsconfig.json",
  "vitest.component.config.ts",
  "vitest.config.ts",
  "vitest.integration.config.ts",
]);

describe("apps/web root", () => {
  it("tracks only project configuration files at the top level", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split(/\r?\n/)
      .filter((f) => f && !f.includes("/"));
    expect(tracked.filter((f) => !ALLOWED.has(f))).toEqual([]);
  });
});
