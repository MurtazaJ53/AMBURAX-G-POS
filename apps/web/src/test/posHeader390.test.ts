import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Bug 29: at 390 px the POS tab labels wrapped onto two lines ("Barcode / Scan") and the header
// search box showed only "Searc", because 56 px of right padding was kept for a Ctrl K hint that is
// hidden below md.
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("POS header at 390 px (bug 29)", () => {
  it("tab labels never wrap", () => {
    const src = read("src/app/(app)/pos/PosTerminal.tsx");
    const tabs = src.match(/role="tab"[\s\S]*?className=\{`[^`]*`\}/g) ?? [];
    expect(tabs.length).toBe(3);
    for (const t of tabs) expect(t).toContain("whitespace-nowrap");
  });

  it("the header search keeps its right padding only where the Ctrl K hint shows", () => {
    const src = read("src/components/shell/GlobalSearch.tsx");
    expect(src).not.toMatch(/className="h-9 w-full[^"]* pr-14 /);
    expect(src).toMatch(/md:pr-14/);
  });
});
