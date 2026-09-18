# AMBURAX Design System (Figma Translation)

## 1. Visual Language extracted from Figma

The Figma implementation uses a clean, data-dense, B2B-friendly aesthetic based on Tailwind CSS.

### Colors
- **Backgrounds**: App background is `slate-50` or `#f1f5f9`. Panels/Cards are `white`.
- **Text**: Primary text is `slate-900` / `slate-800`. Secondary text is `slate-500` / `slate-400`.
- **Brand/Primary**: Blue scale (e.g., `blue-600` for primary buttons, `blue-50` for active states).
- **Status (Semantic)**:
  - Success/Live: `emerald-500` / `emerald-600`
  - Warning: `amber-500` / `f59e0b`
  - Error/Destructive: `red-500` / `ef4444`
  - Accent/Category: `purple-500` / `8b5cf6`

### Typography
- **Font Family**: Inter (sans-serif)
- **Base Size**: 14px (`text-sm`) for readability in data-dense tables, scaling down to 12px (`text-xs`) for UI controls and 10px (`text-[10px]`) for metadata.
- **Weights**: 
  - Regular (400) for body data.
  - Medium (500) for secondary labels.
  - Semibold (600) for control labels.
  - Bold (700) for key metrics and headers.

### Layout & Spacing
- **Sidebar width**: ~240px.
- **Header height**: ~56px.
- **Border Radius**: 
  - Cards, Buttons, and Inputs use `.rounded-xl` (12px) or `.rounded-lg` (8px).
- **Borders**: Subtle `border-slate-200` everywhere.

## 2. AMBURAX Design Tokens (Proposal)

These tokens map the hardcoded Tailwind values into semantic AMBURAX CSS variables (ready for theming).

```css
:root {
  /* Core Palette */
  --color-bg-app: theme('colors.slate.50');
  --color-bg-card: theme('colors.white');
  --color-bg-hover: theme('colors.slate.50');
  --color-bg-active: theme('colors.blue.50');

  /* Typography */
  --font-sans: 'Inter', sans-serif;
  --color-text-primary: theme('colors.slate.900');
  --color-text-secondary: theme('colors.slate.500');
  --color-text-tertiary: theme('colors.slate.400');

  /* Borders & Shadows */
  --color-border: theme('colors.slate.200');
  --color-border-hover: theme('colors.slate.300');
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem; /* Matches rounded-xl */

  /* Semantic / Status */
  --color-primary: theme('colors.blue.600');
  --color-primary-hover: theme('colors.blue.700');
  --color-success: theme('colors.emerald.500');
  --color-warning: theme('colors.amber.500');
  --color-danger: theme('colors.red.500');
}
```

## 3. Component Inventory (Figma -> AMBURAX)

| Figma Pattern | AMBURAX Equivalent | Reusable? | Target Module |
|---------------|-------------------|-----------|---------------|
| `aside` | `<AppSidebar>` | Yes | `apps/web/src/components/shell/` |
| `header` | `<TopNav>` | Yes | `apps/web/src/components/shell/` |
| Store Selector | `<StoreSwitcher>` | Yes | `apps/web/src/components/shell/` |
| Global Search | `<CommandPalette>` | Yes | `apps/web/src/components/shell/` |
| User Profile | `<UserMenu>` | Yes | `apps/web/src/components/shell/` |
| KPI Metric Card | `<StatCard>` | Yes | `apps/web/src/components/ui/` |
| Recharts wrappers | `<ChartBase>` | Yes | `apps/web/src/components/ui/` |
| Recent Sales list | `<RecentSalesWidget>` | No | `apps/web/src/app/(app)/dashboard/` |
| Low Stock list | `<StockAlertWidget>` | No | `apps/web/src/app/(app)/dashboard/` |
| Status Pill | `<Badge>` | Yes | `apps/web/src/components/ui/` |

## 4. Addressing Hardcoded Assumptions

The Figma source is entirely hardcoded for:
- **Tenant Data**: "ATELIER RETAIL"
- **Store Data**: "Indiranagar", "Store #01"
- **User Data**: "Ramesh Sharma", "Store Manager"
- **Domain Data**: "Garment POS"
- **Capability Data**: Fully assumed Retail POS context (Sales, Bills, Low Stock).

**Action Plan**:
- Replace string literals with data fetched via TanStack Query (e.g. `useCurrentStore()`, `useCurrentUser()`).
- Wrap POS-specific widgets inside capability checks (e.g., `if (hasCapability('RETAIL')) { render PosMetrics }`).
