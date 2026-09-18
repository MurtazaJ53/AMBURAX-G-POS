# AMBURAX Dashboard Architecture

## 1. Information Architecture Strategy

The AMBURAX dashboard must not be a static single-view page. AMBURAX serves multiple operational models (Retail, Wholesale, Manufacturing, Job Work). The dashboard must be dynamically assembled based on the tenant's enabled capabilities and the user's role.

### Dashboard Widget Strategy

**Universal Widgets (Always shown)**
- Activity Feed / Recent Actions (Sales, Orders, Shipments depending on role)
- System Notifications / Alerts

**Capability: Retail & POS**
- Today's Sales & Transactions
- Active POS Terminals & Shifts Status
- Fast Moving Products (Retail)
- Store Sales vs Target

**Capability: Wholesale & B2B Commerce**
- Open Orders / Pending Fulfillment
- Outstanding Receivables / Khata Balances
- Recent B2B Customers
- Top B2B Categories

**Capability: Inventory Management**
- Low Stock Alerts (from Figma)
- Pending Stock Receipts / Transfers
- Inventory Valuation (if permitted by role)

### Role-Aware Strategy
- **OWNER**: Sees cross-store aggregated revenue, inventory value, target metrics.
- **STORE MANAGER**: Sees local store metrics, staff activity, shift status, local stock alerts.
- **CASHIER/STAFF**: Should probably bypass the analytical dashboard entirely and land on `/pos` or `/till` directly. A cashier does not need to see store-wide margins.

## 2. Dashboard Data Mapping

Mapping the Figma static data to actual AMBURAX APIs.

| Figma Widget | AMBURAX Backend Source | Status | Strategy |
|--------------|------------------------|--------|----------|
| Today Sales & Bills | `sales` table (aggregate sum/count where created >= today) | **PARTIALLY AVAILABLE** | Needs a projection endpoint (e.g. `GET /api/v1/dashboard/sales-metrics`). Cannot fetch raw sales to aggregate on client. |
| New Customers | `customers` table (count where created >= today) | **PARTIALLY AVAILABLE** | Add to `GET /api/v1/dashboard/customer-metrics`. |
| Inventory Value | `inventory_levels` * `variants.price` | **FUTURE** | High-cost query. Requires a periodic projection or materialized view. |
| Hourly Sales Chart | `sales` table (grouped by hour) | **NOT AVAILABLE** | Requires timeseries aggregation API. |
| Low Stock Alerts | `inventory_levels` < reorder point | **NOT AVAILABLE** | Requires a dedicated alert query in inventory API. |
| Recent Sales | `sales` table (ORDER BY createdAt DESC LIMIT 5) | **AVAILABLE** | Exists in `GET /api/v1/sales`. |

*Rule:* The dashboard must gracefully omit or display empty states for metrics that are NOT AVAILABLE, rather than fetching 10,000 rows to the client to aggregate.

## 3. Data + State Architecture

- **State Layer**: We will use **TanStack Query** (React Query) for all dashboard metrics.
- **Polling / Realtime**: Core metrics (e.g., Active POS Terminals, Shift Live status) can use React Query `refetchInterval` (e.g. 30s) or Server-Sent Events (SSE) if introduced.
- **URL State**: The selected Store or Date Range must be persisted in the URL query string (`?storeId=...&date=today`) so the dashboard is shareable and reloadable.
- **Global UI State**: Avoided. The Shell state (Sidebar open/closed) can remain local to the Shell layout component or use a lightweight Zustand store if needed across deep components.

## 4. Performance Strategy

- **Server vs Client Components (Next.js)**: 
  - The App Shell layout can be mostly Server Components.
  - The Dashboard itself needs client-side interactivity (Recharts requires `<canvas>`/SVG in the browser and responsive measurements). The chart wrappers must be marked `"use client"`.
- **Parallel Fetching**: Dashboard data must be fetched using parallel endpoints or a single aggregated GraphQL-like endpoint so it doesn't waterfall.
- **Suspense Boundaries**: Wrap each widget in a `<Suspense fallback={<WidgetSkeleton />}>` so slow metrics (like Inventory Value) do not block fast metrics (like Recent Sales).

## 5. Security Considerations

- **Authorization Boundary**: The frontend NEVER trusts the client. If a Store Manager attempts to fetch `GET /api/v1/dashboard/sales-metrics?storeId=OTHER_STORE`, the backend MUST enforce RBAC and return 403.
- **Data Leakage**: The dashboard must ensure that aggregated totals exclude voided transactions or data outside the user's explicit capability grants.

## 6. Responsive Strategy

The Figma design is primarily Desktop-focused.
- **Mobile (Phone)**: The Sidebar must become a bottom navigation bar or a hamburger drawer. The 3-column metric grids must stack vertically (`grid-cols-1`).
- **Tablet**: Sidebar can collapse to icons only. Grid becomes 2-column. Tables scroll horizontally.
- **POS Terminal**: If accessed on a POS screen (often 1024x768 landscape), the UI must maximize vertical space. The header might need to be slimmer.
