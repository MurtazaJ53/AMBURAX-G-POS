import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { backendWording } from "@/lib/backendWording";

// Owner decision 2026-10-28: screens call the system G-POS syncs to "accounting". They never
// name ERPNext (decision 2026-10-20), and "Backend" meant nothing to a shop owner.
describe("owner-facing wording: accounting", () => {
  it("rewrites technical names in sync errors as accounting, and the database as the database", () => {
    expect(backendWording("ERPNext refused the invoice")).toBe("Accounting refused the invoice");
    expect(backendWording("Could not reach ERPNext. Try again.")).toBe("Could not reach accounting. Try again.");
    expect(backendWording("Frappe Cloud is down")).toBe("Accounting hosting is down");
    expect(backendWording("Postgres timed out")).toBe("The database timed out");
  });

  it("no source file says Backend any more", () => {
    const root = path.resolve(__dirname, "..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!["test", "test-integration", "test-component", "node_modules"].includes(entry.name)) walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && /\bBackend\b/.test(fs.readFileSync(full, "utf8"))) {
          hits.push(path.relative(root, full));
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  }, 45000);
});
