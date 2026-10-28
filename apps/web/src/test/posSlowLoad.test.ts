import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Bug 14: on a slow first load the POS showed grey placeholders and "All, 0 items" for 15 s+ with
// no message and no way to retry. PosTerminal can't be rendered in this suite, so this checks it
// has a timed "still loading" state with a retry that re-runs the catalogue requests.
const src = readFileSync(join(process.cwd(), "src/app/(app)/pos/PosTerminal.tsx"), "utf8");

describe("POS slow first load (bug 14)", () => {
  it("arms a timer while the grid is empty and loading", () => {
    expect(src).toMatch(/if \(!\(searching && results\.length === 0\)\)[\s\S]{0,120}setSlowLoad\(false\)/);
    expect(src).toMatch(/setTimeout\(\(\) => setSlowLoad\(true\), SLOW_LOAD_MS\)/);
  });

  it("shows a still-loading message with a retry that refetches", () => {
    expect(src).toMatch(/\{slowLoad && \(/);
    expect(src).toMatch(/Still loading the products/);
    expect(src).toMatch(/onClick=\{\(\) => setCatalogVersion\(\(v\) => v \+ 1\)\}[\s\S]{0,300}Retry/);
  });
});
