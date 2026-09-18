import { render, screen, waitFor } from "./render";
import { expect, test, vi } from "vitest";

vi.mock("lucide-react", () => {
  const Icon = () => <svg data-testid="lucide-icon" />;
  return {
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
    X: Icon,
    Menu: Icon,
    Plus: Icon,
    Store: Icon,
    ChevronDown: Icon,
    Search: Icon,
    LogOut: Icon,
    User: Icon
  };
});

vi.mock("@/test-component/nextNavigationStub.ts", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/sales"
}));

import { AppShell } from "@/components/shell/AppShell";
import { AppSidebar } from "@/components/shell/AppSidebar";

test("AppShell renders sidebar and header with context", () => {
  render(
    <AppShell
      tenantCapabilities={["RETAIL"]}
      storeName="Indiranagar"
      storeCode="IND01"
      userName="Test User"
      roleLabel="Manager"
      canSell={true}
    >
      <div>Workspace Content</div>
    </AppShell>
  );

  expect(screen.getByText("Workspace Content")).toBeTruthy();
  expect(screen.getByText("Indiranagar")).toBeTruthy();
  expect(screen.getByText("#IND01")).toBeTruthy();
  expect(screen.getByText("Test User")).toBeTruthy();
});

test("AppSidebar capability filtering - No caps", () => {
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
