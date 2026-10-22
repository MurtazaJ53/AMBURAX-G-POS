import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "./render";

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => nav.params,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, className, ...rest }: any) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("lucide-react", () => {
  const Icon = () => <svg data-testid="icon" />;
  const names = ["CheckCircle2", "Download", "Filter", "Loader2", "Phone", "Plus", "Search", "Send", "Upload", "User", "X"];
  return Object.fromEntries(names.map((name) => [name, Icon]));
});

const { CustomerToolbar } = await import("@/app/(app)/customers/CustomerClient");

function renderToolbar(query: string, status: "inactive" | "" = "") {
  nav.params = new URLSearchParams(query);
  return render(<CustomerToolbar initialQuery={nav.params.get("q") ?? ""} initialType={nav.params.get("customerType") ?? ""} status={status} total={3} />);
}

beforeEach(() => cleanup());

describe("Customers view tabs", () => {
  test("All Customers is selected by default and Inactive (>90d) links to status=inactive", () => {
    renderToolbar("");
    const all = screen.getByRole("tab", { name: "All Customers" });
    const inactive = screen.getByRole("tab", { name: "Inactive (>90d)" });
    expect(all.getAttribute("aria-selected")).toBe("true");
    expect(inactive.getAttribute("aria-selected")).toBe("false");
    expect(inactive.getAttribute("href")).toBe("/customers?status=inactive");
  });

  test("Inactive (>90d) is selected when status=inactive, and All links back without it", () => {
    renderToolbar("status=inactive", "inactive");
    const all = screen.getByRole("tab", { name: "All Customers" });
    const inactive = screen.getByRole("tab", { name: "Inactive (>90d)" });
    expect(inactive.getAttribute("aria-selected")).toBe("true");
    expect(inactive.getAttribute("aria-current")).toBe("page");
    expect(all.getAttribute("aria-selected")).toBe("false");
    expect(all.getAttribute("href")).toBe("/customers");
  });

  test("the tab links keep search and segment, and drop page and selection", () => {
    renderToolbar("q=ali&customerType=RETAIL&page=3&selected=c1");
    const href = screen.getByRole("tab", { name: "Inactive (>90d)" }).getAttribute("href")!;
    const p = new URLSearchParams(href.split("?")[1]);
    expect(p.get("q")).toBe("ali");
    expect(p.get("customerType")).toBe("RETAIL");
    expect(p.get("status")).toBe("inactive");
    expect(p.has("page")).toBe(false);
    expect(p.has("selected")).toBe(false);
  });

  test("the cohort views provide valid links", () => {
    renderToolbar("");
    const active = screen.getByRole("tab", { name: "Active (<30d)" });
    expect(active.getAttribute("href")).toBe("/customers?cohort=active");
    const lapsed = screen.getByRole("tab", { name: "Lapsed (30-90d)" });
    expect(lapsed.getAttribute("href")).toBe("/customers?cohort=lapsed");
    const newCust = screen.getByRole("tab", { name: "New (30d)" });
    expect(newCust.getAttribute("href")).toBe("/customers?cohort=new");
    const segments = screen.getByRole("tab", { name: "Segments" });
    expect(segments.getAttribute("href")).toBe("/customers/segments");
  });
});
