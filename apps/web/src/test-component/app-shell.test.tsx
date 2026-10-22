import * as React from "react";
import { render, screen, within } from "./render";
import { expect, test, vi } from "vitest";

/**
 * The application shell: sidebar, header, and the context they carry.
 *
 * The assertions that matter most here are the negative ones. The design reference this
 * shell was rebuilt against ships hardcoded branding — a business name, an outlet, a person —
 * and the whole point of the rebuild is that none of those strings survive into the product.
 * So these tests check both that real context appears and that a store with no open till does
 * not claim to have one.
 */

vi.mock("lucide-react", () => {
  const Icon = () => <svg data-testid="lucide-icon" />;
  return {
    Activity: Icon,
    ScanLine: Icon,
    RefreshCw: Icon,
    CheckCircle2: Icon,
    AlertTriangle: Icon,
    WifiOff: Icon,
    Wifi: Icon,
    LayoutDashboard: Icon,
    MonitorSmartphone: Icon,
    Tag: Icon,
    Package: Icon,
    Users: Icon,
    Briefcase: Icon,
    FileText: Icon,
    Percent: Icon,
    BarChart3: Icon,
    Globe: Icon,
    Settings: Icon,
    BrainCircuit: Icon,
    Building2: Icon,
    Truck: Icon,
    ArrowLeftRight: Icon,
    UserCog: Icon,
    Wallet: Icon,
    X: Icon,
    Menu: Icon,
    Plus: Icon,
    Store: Icon,
    ChevronDown: Icon,
    Search: Icon,
    LogOut: Icon,
    User: Icon,
    Cloud: Icon,
    Bell: Icon,
    Clock3: Icon,
  };
});

vi.mock("@/test-component/nextNavigationStub.ts", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/sales",
}));

import { AppShell } from "@/components/shell/AppShell";
import { AppSidebar } from "@/components/shell/AppSidebar";

function renderShell(overrides: Partial<React.ComponentProps<typeof AppShell>> = {}) {
  return render(
    <AppShell
      tenantCapabilities={["RETAIL"]}
      tenantName="Northline Traders"
      storeName="Indiranagar"
      storeCode="IND01"
      userName="Asha Menon"
      roleLabel="Store Manager"
      canSell={true}
      tillOpen={false}
      {...overrides}
    >
      <div>Workspace Content</div>
    </AppShell>,
  );
}

test("AppShell renders its children inside the sidebar and header", () => {
  renderShell();

  expect(screen.getByText("Workspace Content")).toBeTruthy();
  // Store identity appears in both the header switcher and the sidebar's active-store card.
  expect(screen.getAllByText("Indiranagar").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Asha Menon").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Store Manager").length).toBeGreaterThan(0);
});

test("the sidebar shows the tenant's own name, never the reference's branding", () => {
  renderShell();

  // The sidebar prints the tenant name with the version: "Northline Traders · V1.0".
  expect(screen.getByText(/Northline Traders/)).toBeTruthy();
  expect(screen.getByText("AMBURAX")).toBeTruthy();
  expect(screen.queryByText("ATELIER RETAIL")).toBeNull();
  expect(screen.queryByText(/Garment POS/)).toBeNull();
});

test("the till indicator says no till is open when none is", () => {
  renderShell({ tillOpen: false });

  // Header wording since the 2026-10-04 shell pass: "Shift" / "No shift" when closed.
  expect(screen.getByText("No shift")).toBeTruthy();
  expect(screen.queryByText("Shift Active")).toBeNull();
});

test("the till indicator reports an open till when one is open", () => {
  renderShell({ tillOpen: true });

  expect(screen.getByText("Shift Active")).toBeTruthy();
  expect(screen.queryByText("No shift")).toBeNull();
});

test("the primary action is shown to someone who may sell", () => {
  renderShell({ canSell: true });
  expect(screen.getAllByRole("link", { name: /New sale/i }).length).toBeGreaterThan(0);
});

test("the primary action is absent for someone who may not sell", () => {
  renderShell({ canSell: false });
  expect(screen.queryByRole("link", { name: /New sale/i })).toBeNull();
});

test("the notification bell is disabled and shows no count, because nothing counts notifications yet", () => {
  renderShell();
  const bell = screen.getByRole("button", { name: /notification/i }) as HTMLButtonElement;
  expect(bell.disabled).toBe(true);
  // No fabricated unread badge.
  expect(bell.textContent?.trim()).toBe("");
});

// ── Navigation ───────────────────────────────────────────────────────────────

test("the active route is marked for assistive technology, not only in colour", () => {
  // usePathname is stubbed to /sales above.
  render(<AppSidebar tenantCapabilities={["RETAIL"]} />);

  const current = screen.getByRole("link", { current: "page" });
  expect(within(current).getByText("Sales")).toBeTruthy();
});

test("AppSidebar capability filtering - no capabilities", () => {
  render(<AppSidebar tenantCapabilities={[]} />);

  expect(screen.getByText("Dashboard")).toBeTruthy();
  expect(screen.getByText("Sales")).toBeTruthy();
  expect(screen.queryByText("POS")).toBeNull();
});

test("AppSidebar capability filtering - RETAIL", () => {
  render(<AppSidebar tenantCapabilities={["RETAIL"]} />);

  expect(screen.getByText("POS")).toBeTruthy();
  expect(screen.getByText("Offers & Loyalty")).toBeTruthy();
  expect(screen.queryByText("Leads & Quotations")).toBeNull();
});

test("AppSidebar capability filtering - WHOLESALE", () => {
  render(<AppSidebar tenantCapabilities={["WHOLESALE"]} />);

  expect(screen.queryByText("POS")).toBeNull();
  expect(screen.getByText("Leads & Quotations")).toBeTruthy();
});

test("the mobile drawer is a labelled modal and closes on request", () => {
  const onMobileClose = vi.fn();
  render(
    <AppSidebar
      tenantCapabilities={["RETAIL"]}
      storeName="Indiranagar"
      storeCode="IND01"
      isMobileOpen={true}
      onMobileClose={onMobileClose}
    />,
  );

  const dialog = screen.getByRole("dialog");
  expect(dialog.getAttribute("aria-modal")).toBe("true");

  within(dialog).getByRole("button", { name: "Close navigation" }).click();
  expect(onMobileClose).toHaveBeenCalled();
});

test("the drawer is absent until it is opened", () => {
  render(<AppSidebar tenantCapabilities={["RETAIL"]} isMobileOpen={false} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});
