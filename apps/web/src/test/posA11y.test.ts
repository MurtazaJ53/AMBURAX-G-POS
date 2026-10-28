import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Bug 27 (axe-core 4.10.2 on /till and /pos). PosTerminal is a 3,000-line client component that
// can't be rendered here, so these check the markup axe flagged.
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("POS and shell accessibility (bug 27)", () => {
  it("the account menu button has a name when the user's name is hidden (390 px)", () => {
    const src = read("src/components/shell/UserMenu.tsx");
    expect(src).toMatch(/<DropdownMenuTrigger[^>]*aria-label=/);
  });

  it("the entry-mode tablist holds only tabs", () => {
    const src = read("src/app/(app)/pos/PosTerminal.tsx");
    const start = src.indexOf('role="tablist"');
    expect(start).toBeGreaterThan(-1);
    // The element that carries role="tablist" must close before the offline pill.
    const tag = src.lastIndexOf("<div", start);
    const pill = src.indexOf("<OfflineIndicatorPill", start);
    let depth = 0;
    let i = tag;
    let closedAt = -1;
    const re = /<div\b|<\/div>/g;
    re.lastIndex = tag;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      depth += m[0] === "</div>" ? -1 : 1;
      if (depth === 0) {
        closedAt = m.index;
        break;
      }
      i = m.index;
    }
    void i;
    expect(closedAt).toBeGreaterThan(-1);
    expect(closedAt).toBeLessThan(pill);
  });

  it("the product results scroll region can be reached by keyboard", () => {
    const src = read("src/app/(app)/pos/PosTerminal.tsx");
    expect(src).toMatch(/<div\s+tabIndex=\{0\}\s+role="region"\s+aria-label="Product results"\s+className="h-\[60vh\]/);
  });
});
