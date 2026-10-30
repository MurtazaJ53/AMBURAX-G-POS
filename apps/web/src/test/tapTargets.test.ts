import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Bug 28: tap targets measured on a phone well under 44 x 44 px: "Close navigation" 26 x 26,
// list/grid toggles 35 x 27, quick-cash 87 x 29, sidebar links short. Each must reserve at least
// 44 px (Tailwind min-h-11 / min-w-11) where a finger uses it.
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

function classesNear(src: string, marker: string, re = /className=(?:"([^"]*)"|\{cn\(\s*"([^"]*)"|\{`([^`]*)`\})/): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const window = src.slice(at, at + 600);
  const m = window.match(re);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}

function templateClassesNear(src: string, marker: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const window = src.slice(at, at + 600);
  const m = window.match(/className=\{`([^`]*)`\}/);
  return m ? m[1] ?? "" : "";
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

  it("Cart item discount and delete buttons in PosTerminal.tsx", () => {
    const src = read("src/app/(app)/pos/PosTerminal.tsx");
    expect(classesNear(src, 'aria-label={`Apply discount on ${line.productName}`}')).toMatch(/min-h-11/);
    expect(classesNear(src, 'aria-label={`Apply discount on ${line.productName}`}')).toMatch(/min-w-11/);
    expect(classesNear(src, 'aria-label={`Remove ${line.productName} from cart`}')).toMatch(/min-h-11/);
    expect(classesNear(src, 'aria-label={`Remove ${line.productName} from cart`}')).toMatch(/min-w-11/);
  });

  it("Cart quantity minus and plus buttons in PosTerminal.tsx", () => {
    const src = read("src/app/(app)/pos/PosTerminal.tsx");
    expect(classesNear(src, 'aria-label={`Decrease quantity of ${line.productName}`}')).toMatch(/min-h-11/);
    expect(classesNear(src, 'aria-label={`Decrease quantity of ${line.productName}`}')).toMatch(/min-w-11/);
    expect(classesNear(src, 'aria-label={`Increase quantity of ${line.productName}`}')).toMatch(/min-h-11/);
    expect(classesNear(src, 'aria-label={`Increase quantity of ${line.productName}`}')).toMatch(/min-w-11/);
  });

  it("Payment method pills in PosTerminal.tsx", () => {
    const src = read("src/app/(app)/pos/PosTerminal.tsx");
    expect(templateClassesNear(src, "aria-pressed={selected}")).toMatch(/min-h-11/);
  });

  it("Checkout & tender inputs including amountReceived in PosTerminal.tsx", () => {
    const src = read("src/app/(app)/pos/PosTerminal.tsx");
    expect(classesNear(src, 'id="amount-received"')).toMatch(/min-h-11/);
    expect(classesNear(src, 'aria-label={`Payment ${i + 1} method`}')).toMatch(/min-h-11/);
    expect(classesNear(src, 'aria-label={`Payment ${i + 1} amount`}')).toMatch(/min-h-11/);
    expect(classesNear(src, 'aria-label={`Remove payment ${i + 1}`}')).toMatch(/min-h-11/);
    expect(classesNear(src, 'aria-label={`Remove payment ${i + 1}`}')).toMatch(/min-w-11/);
    expect(classesNear(src, 'setSplitPayments((curr) => [...curr, { id: Date.now().toString()')).toMatch(/min-h-11/);
    expect(classesNear(src, 'aria-label="Add customer for udhar"')).toMatch(/min-h-11/);
    expect(classesNear(src, 'aria-label="Paid now by"')).toMatch(/min-h-11/);
  });

  it("Bill discount panel controls in PosTerminal.tsx", () => {
    const src = read("src/app/(app)/pos/PosTerminal.tsx");
    expect(classesNear(src, 'placeholder={discountKind === "percent" ? "Discount %" : "Discount ₹"}')).toMatch(/min-h-11/);
    expect(templateClassesNear(src, 'aria-label="Discount as a percentage"')).toMatch(/min-h-11/);
    expect(templateClassesNear(src, 'aria-label="Discount as a percentage"')).toMatch(/min-w-11/);
    expect(templateClassesNear(src, 'aria-label="Discount as an amount"')).toMatch(/min-h-11/);
    expect(templateClassesNear(src, 'aria-label="Discount as an amount"')).toMatch(/min-w-11/);
    expect(classesNear(src, 'aria-label="Discount reason"')).toMatch(/min-h-11/);
    expect(classesNear(src, "onClick={applyDiscount}")).toMatch(/min-h-11/);
    expect(classesNear(src, 'aria-label="Manager approving this discount"')).toMatch(/min-h-11/);
  });

  it("Search clear button in PosTerminal.tsx", () => {
    const src = read("src/app/(app)/pos/PosTerminal.tsx");
    expect(classesNear(src, 'aria-label="Clear product search"')).toMatch(/min-h-11/);
    expect(classesNear(src, 'aria-label="Clear product search"')).toMatch(/min-w-11/);
  });

  it('SessionPanel "Quick close without counting" summary in SessionPanel.tsx', () => {
    const src = read("src/app/(app)/till/_components/SessionPanel.tsx");
    const line = src.split("\n").find((l) => l.includes("Quick close without counting"))!;
    expect(line).toMatch(/min-h-11/);
    expect(line).toMatch(/flex/);
    expect(line).toMatch(/items-center/);
  });

  it("BillPanel line-item Remove button in BillPanel.tsx", () => {
    const src = read("src/app/(app)/till/_components/BillPanel.tsx");
    const line = src.split("\n").find((l) => l.includes('Remove ${line.productName} from the bill'))!;
    expect(line).toBeDefined();
    const btnBlock = src.slice(src.indexOf('aria-label={`Remove ${line.productName} from the bill`}') - 100, src.indexOf('aria-label={`Remove ${line.productName} from the bill`}') + 200);
    expect(btnBlock).toMatch(/className=.*min-h-11.*min-w-11|className=.*min-w-11.*min-h-11/);
  });
});
