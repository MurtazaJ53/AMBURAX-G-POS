import { render, screen, waitFor } from "./render";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * The dashboard, rendered.
 *
 * These tests exist to catch the two failures a server-rendered figure cannot catch on its
 * own: a widget that maps the wrong field onto the screen, and a widget that fills an absence
 * with something reassuring. So alongside the happy paths there are assertions that "no
 * comparison", "no target configured" and the empty states actually appear — a dashboard
 * whose empty states silently render as zeroes is the specific bug this feature was written
 * to avoid.
 */

vi.mock("lucide-react", () => {
  // Enumerated rather than proxied: Vitest validates a mock's exports against the real
  // module, so a catch-all Proxy is rejected. Every icon the dashboard tree imports is
  // listed here; adding one to a card means adding it here too, which the failure message
  // says plainly.
  const Icon = () => <svg data-testid="icon" />;
  const names = [
    "BarChart3",
    "Package",
    "ShoppingBag",
    "ShoppingCart",
    "UserPlus",
    "CalendarDays",
    "Plus",
    "Users",
    "CheckCircle2",
    "CircleDot",
  ];
  return Object.fromEntries(names.map((name) => [name, Icon]));
});

vi.mock("@/test-component/nextNavigationStub.ts", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
}));

import { KpiGrid } from "@/components/dashboard/KpiGrid";
import { CategorySalesCard, PaymentMethodsCard } from "@/components/dashboard/AnalyticsCards";
import {
  FastMovingProductsCard,
  RecentSalesCard,
  StockSignalCard,
} from "@/components/dashboard/OperationsCards";
import {
  ShiftStatusCard,
  SystemStatusCard,
  TargetsCard,
} from "@/components/dashboard/BusinessCards";
import { SalesTrendCard } from "@/components/dashboard/SalesTrendCard";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import type {
  DashboardShiftActivity,
  DashboardStockSignal,
  DashboardTodayMetrics,
} from "@/server/dashboard/dashboardQueries";

const metrics: DashboardTodayMetrics = {
  salesMinor: 125_000,
  billCount: 8,
  itemsSold: 21,
  newCustomers: 2,
  averageBillMinor: 15_625,
  averageItemsPerBill: 2.6,
  previous: { salesMinor: 100_000, billCount: 10, itemsSold: 20, newCustomers: 4 },
};

const emptyMetrics: DashboardTodayMetrics = {
  salesMinor: 0,
  billCount: 0,
  itemsSold: 0,
  newCustomers: 0,
  averageBillMinor: null,
  averageItemsPerBill: null,
  previous: { salesMinor: 0, billCount: 0, itemsSold: 0, newCustomers: 0 },
};

const stock: DashboardStockSignal = {
  countedVariants: 40,
  uncountedVariants: 3,
  outOfStock: 2,
  oversold: 1,
  lowest: [
    {
      variantId: "v1",
      productName: "Cotton shirt",
      sku: "SH-1",
      quantity: -2,
      imageUrl: "/demo/catalogue/shirts.svg",
    },
    { variantId: "v2", productName: "Linen trouser", sku: "TR-9", quantity: 0, imageUrl: null },
    { variantId: "v3", productName: "Wool scarf", sku: "SC-4", quantity: 5, imageUrl: null },
  ],
};

const emptyStock: DashboardStockSignal = {
  countedVariants: 0,
  uncountedVariants: 0,
  outOfStock: 0,
  oversold: 0,
  lowest: [],
};

const shift: DashboardShiftActivity = {
  openSessions: 2,
  cashiers: [
    { userId: "u1", name: "Priya Nair" },
    { userId: "u2", name: "Rohit Kumar" },
  ],
  staffCount: 5,
};

// ── KPI mapping ──────────────────────────────────────────────────────────────

test("KPI cards map each figure onto the right card", () => {
  render(<KpiGrid metrics={metrics} stock={stock} />);

  expect(screen.getByText("₹1,250.00")).toBeTruthy();
  expect(screen.getByText("8")).toBeTruthy();
  expect(screen.getByText("21")).toBeTruthy();
  expect(screen.getByText("Average bill ₹156.25")).toBeTruthy();
  expect(screen.getByText("Average 2.6 per bill")).toBeTruthy();
});

test("KPI movement is computed against yesterday, in both directions", () => {
  render(<KpiGrid metrics={metrics} stock={stock} />);

  // Sales rose 1000.00 -> 1250.00, which is +25%; bills fell from 10 to 8, which is -20%.
  expect(screen.getByText("+25%")).toBeTruthy();
  expect(screen.getByText("-20%")).toBeTruthy();
});

test("a day with no trade yesterday shows no comparison rather than a percentage", () => {
  render(<KpiGrid metrics={emptyMetrics} stock={emptyStock} />);

  expect(screen.getAllByText("No yesterday comparison").length).toBeGreaterThan(0);
  expect(screen.getByText("No sales yet today")).toBeTruthy();
  expect(screen.queryByText("+100%")).toBeNull();
});

test("the fifth KPI reports counted stock and says why there is no valuation", () => {
  render(<KpiGrid metrics={metrics} stock={stock} />);

  expect(screen.getByText("Stock counted")).toBeTruthy();
  expect(screen.getByText("40")).toBeTruthy();
  expect(screen.getByText("No valuation — variants carry no cost price")).toBeTruthy();
});

// ── Category and payment shares ──────────────────────────────────────────────

test("category shares render with their percentages", () => {
  render(
    <CategorySalesCard
      categories={[
        { key: "Shirts", label: "Shirts", amountMinor: 60_000, sharePct: 60 },
        { key: "Trousers", label: "Trousers", amountMinor: 40_000, sharePct: 40 },
      ]}
      uncategorisedMinor={0}
    />,
  );

  expect(screen.getByText("Shirts")).toBeTruthy();
  expect(screen.getByText("60%")).toBeTruthy();
  expect(screen.getByText("₹600.00")).toBeTruthy();
});

test("uncategorised revenue is disclosed so the shares are not read as the whole day", () => {
  render(
    <CategorySalesCard
      categories={[{ key: "Shirts", label: "Shirts", amountMinor: 10_000, sharePct: 100 }]}
      uncategorisedMinor={90_000}
    />,
  );

  expect(screen.getByText(/Shares are of categorised sales only/)).toBeTruthy();
});

test("category card shows an empty state instead of a zeroed ranking", () => {
  render(<CategorySalesCard categories={[]} uncategorisedMinor={0} />);
  expect(screen.getByText("No categorised sales today")).toBeTruthy();
});

test("payment mix renders each tender with its real share", () => {
  const { container } = render(
    <PaymentMethodsCard
      rows={[
        { key: "UPI", label: "UPI", amountMinor: 7_000, sharePct: 70 },
        { key: "CASH", label: "Cash", amountMinor: 3_000, sharePct: 30 },
      ]}
      totalMinor={10_000}
    />,
  );

  expect(screen.getByText("UPI")).toBeTruthy();
  expect(screen.getByText("70%")).toBeTruthy();
  expect(container.querySelector("svg[role='img']")).toBeTruthy();
});

test("payment mix shows an empty state when nothing has been settled", () => {
  render(<PaymentMethodsCard rows={[]} totalMinor={0} />);
  expect(screen.getByText("Nothing settled yet today")).toBeTruthy();
});

// ── Operational tables ───────────────────────────────────────────────────────

test("fast moving products are ranked and show real SKUs", () => {
  render(
    <FastMovingProductsCard
      products={[
        {
          variantId: "v1",
          name: "Cotton shirt",
          sku: "SH-1",
          unitsSold: 9,
          revenueMinor: 45_000,
          imageUrl: "/demo/catalogue/shirts.svg",
        },
        {
          variantId: "v2",
          name: "Wool scarf",
          sku: "SC-4",
          unitsSold: 4,
          revenueMinor: 20_000,
          imageUrl: null,
        },
      ]}
    />,
  );

  expect(screen.getByText("Cotton shirt")).toBeTruthy();
  expect(screen.getByText("SH-1")).toBeTruthy();
  expect(screen.getByText("₹450.00")).toBeTruthy();
});

test("a product with a picture shows it; one without falls back to its initial", () => {
  const { container } = render(
    <FastMovingProductsCard
      products={[
        {
          variantId: "v1",
          name: "Cotton shirt",
          sku: "SH-1",
          unitsSold: 9,
          revenueMinor: 45_000,
          imageUrl: "/demo/catalogue/shirts.svg",
        },
        {
          variantId: "v2",
          name: "Wool scarf",
          sku: "SC-4",
          unitsSold: 4,
          revenueMinor: 20_000,
          imageUrl: null,
        },
      ]}
    />,
  );

  const images = container.querySelectorAll("img");
  expect(images).toHaveLength(1);
  expect(images[0]!.getAttribute("src")).toBe("/demo/catalogue/shirts.svg");
  // Decorative: the product name is already in the row, so the picture must not repeat it.
  expect(images[0]!.getAttribute("alt")).toBe("");

  // The one without a picture gets its initial, never a stand-in garment photo.
  expect(screen.getByTitle("No picture for this product yet")).toBeTruthy();
  expect(screen.getByText("W")).toBeTruthy();
});

test("the stock card names itself honestly and explains the missing reorder level", () => {
  render(<StockSignalCard stock={stock} />);

  expect(screen.getByText("Stock signal")).toBeTruthy();
  expect(screen.getByText("3 to check")).toBeTruthy(); // 2 out of stock + 1 oversold
  expect(screen.getByText(/No reorder levels are configured/)).toBeTruthy();
  expect(screen.getByText("-2")).toBeTruthy(); // the oversold row is shown, not clamped
});

test("recent sales link to the bill and report accounting state per row", () => {
  render(
    <RecentSalesCard
      sales={[
        {
          id: "s1",
          billNumber: "POS-0001",
          completedAt: new Date("2026-09-19T03:45:00.000Z"),
          totalMinor: 24_999,
          status: "COMPLETED",
          erpSyncStatus: "PENDING",
          paymentStatus: "CONFIRMED",
          paymentMethod: "UPI",
          customerName: null,
          cashierName: "Priya Nair",
          storeName: "Indiranagar",
        },
      ]}
    />,
  );

  // 03:45Z is 09:15 in the store — the row must not print the UTC clock.
  expect(screen.getByText("09:15")).toBeTruthy();
  expect(screen.getByText("POS-0001")).toBeTruthy();
  expect(screen.getByText("Walk-in")).toBeTruthy();
  expect(screen.getByText("Not posted")).toBeTruthy();
});

test("recent sales shows an empty state rather than an empty table", () => {
  render(<RecentSalesCard sales={[]} />);
  expect(screen.getByText("No sales yet")).toBeTruthy();
});

// ── Business row ─────────────────────────────────────────────────────────────

test("targets state plainly that none is configured", () => {
  render(<TargetsCard />);
  expect(screen.getByText("No target configured")).toBeTruthy();
  expect(screen.getByText(/cannot set or store sales targets yet/)).toBeTruthy();
});

test("shift card reports open tills and names the people on them", () => {
  render(<ShiftStatusCard activity={shift} />);
  expect(screen.getByText("2 tills open")).toBeTruthy();
  expect(screen.getByText("PN")).toBeTruthy();
  expect(screen.getByText("On shift: Priya Nair, Rohit Kumar")).toBeTruthy();
});

test("shift card says no till is open rather than showing an empty avatar row", () => {
  render(<ShiftStatusCard activity={{ openSessions: 0, cashiers: [], staffCount: 3 }} />);
  expect(screen.getByText("No till open")).toBeTruthy();
});

test("system status reports observable facts, including that accounting is not connected", () => {
  render(<SystemStatusCard activity={shift} stock={stock} />);
  expect(screen.getByText("Not connected")).toBeTruthy();
  expect(screen.getByText("3 never counted")).toBeTruthy();
  expect(screen.queryByText("All Systems Operational")).toBeNull();
});

// ── Page header ──────────────────────────────────────────────────────────────

test("the page header greets the real user and names the real store", () => {
  render(
    <DashboardHeader
      greeting="Good morning"
      userName="Asha"
      storeName="Indiranagar"
      tradingDay="Sat, 19 Sep 2026"
      canSell={true}
    />,
  );

  expect(screen.getByText("Good morning, Asha")).toBeTruthy();
  expect(screen.getByText("Sat, 19 Sep 2026")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Open till/ })).toBeTruthy();
});

test("the till shortcut is absent for someone who may not sell", () => {
  render(
    <DashboardHeader
      greeting="Good morning"
      userName="Asha"
      storeName="Indiranagar"
      tradingDay="Sat, 19 Sep 2026"
      canSell={false}
    />,
  );

  expect(screen.queryByRole("link", { name: /Open till/ })).toBeNull();
});

// ── Trend card interaction ───────────────────────────────────────────────────

const initialPoints = [
  { label: "09:00", salesMinor: 5_000, billCount: 2 },
  { label: "10:00", salesMinor: 7_000, billCount: 3 },
];

beforeEach(() => {
  vi.unstubAllGlobals();
});

test("the trend card renders its server-supplied range without fetching", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  render(<SalesTrendCard initialPoints={initialPoints} initialRange="today" />);

  expect(screen.getByText("Hourly sales")).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("changing range requests that range and renders what comes back", async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      points: [
        { label: "13 Sep", salesMinor: 1_000, billCount: 1 },
        { label: "14 Sep", salesMinor: 2_000, billCount: 4 },
      ],
    }),
  }));
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

  render(<SalesTrendCard initialPoints={initialPoints} initialRange="today" />);

  screen.getByRole("tab", { name: "7 days" }).click();

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/dashboard/trend?range=7d",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  // The heading follows the range: hours for a single day, days for a span.
  await waitFor(() => expect(screen.getByText("Daily sales")).toBeTruthy());
  expect(screen.getByRole("tab", { name: "7 days" }).getAttribute("aria-selected")).toBe("true");
});

test("a failed range request says so and offers a retry, without blanking the card", async () => {
  const fetchMock = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

  render(<SalesTrendCard initialPoints={initialPoints} initialRange="today" />);
  screen.getByRole("tab", { name: "30 days" }).click();

  await waitFor(() => expect(screen.getByText("The trend didn't load")).toBeTruthy());
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});

test("a range with no trade shows an empty state, not a flat chart at zero", () => {
  vi.stubGlobal("fetch", vi.fn());

  render(
    <SalesTrendCard
      initialPoints={[
        { label: "09:00", salesMinor: 0, billCount: 0 },
        { label: "10:00", salesMinor: 0, billCount: 0 },
      ]}
      initialRange="today"
    />,
  );

  expect(screen.getByText("No sales recorded for today")).toBeTruthy();
});
