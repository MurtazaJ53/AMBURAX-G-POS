import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Bug 28: tap targets measured on a phone well under 44 x 44 px: "Close navigation" 26 x 26,
// list/grid toggles 35 x 27, quick-cash 87 x 29, sidebar links short. Each must reserve at least
// 44 px (Tailwind min-h-11 / min-w-11) where a finger uses it.
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

function classesNear(src: string, marker: string, re = /className=(?:"([^"]*)"|\{cn\(\s*"([^"]*)")/): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const window = src.slice(at, at + 600);
  const m = window.match(re);
  return m ? (m[1] ?? m[2] ?? "") : "";
}

describe("tap targets are at least 44 px (bug 28)", () => {
  it("Close navigation", () => {
    const src = read("src/components/shell/AppSidebar.tsx");
    const line = src.split("\n").find((l) => l.includes('aria-label="Close navigation"'))!;
    expect(line).toMatch(/min-h-11/);
    expect(line).toMatch(/min-w-11/);
  });

  it("sidebar links on a phone", () => {
    const src = read("src/components/shell/AppSidebar.tsx");
    expect(classesNear(src, 'aria-current={active ? "page" : undefined}')).toMatch(/min-h-11/);
  });

  it("catalogue list/grid toggles", () => {
    const src = read("src/components/catalog/CatalogGrid.tsx");
    expect(classesNear(src, "aria-pressed={active}")).toMatch(/min-h-11.*min-w-11|min-w-11.*min-h-11/);
  });

  it("inventory table/grid toggles", () => {
    const src = read("src/components/inventory/InventoryGrid.tsx");
    expect(classesNear(src, "aria-pressed={view === id}")).toMatch(/min-h-11.*min-w-11|min-w-11.*min-h-11/);
  });

  it("quick-cash and Exact buttons", () => {
    const src = read("src/app/(app)/pos/PosTerminal.tsx");
    expect(classesNear(src, "onClick={() => setAmountReceived(amount)}")).toMatch(/min-h-11/);
    expect(classesNear(src, "onClick={() => setAmountReceived(totals.totalMinor / 100)}")).toMatch(/min-h-11/);
  });
});
