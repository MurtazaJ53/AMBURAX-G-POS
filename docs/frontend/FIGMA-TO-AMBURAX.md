# Figma to AMBURAX Frontend Architecture Translation

This document audits the Figma-generated source code and outlines the strict translation strategy for merging it into the authoritative AMBURAX Next.js codebase.

## 1. Figma Source Audit (React/Vite -> Next.js App Router)

The Figma export provided a React + Vite + Tailwind v4 project (`App.tsx`).

### What We KEEP
- **Visual Design**: The Tailwind utility class compositions (colors, spacing, typography, flexbox structures, rounded corners).
- **SVG Paths**: The inline SVG icons can be extracted to a centralized Icon component library (e.g., `Lucide-react` or custom SVG components).
- **Chart Configurations**: The Recharts configuration (props, margins, colors, tooltip formatting).

### What We DISCARD / REWRITE
- **Vite/React SPA Architecture**: Discarded. AMBURAX uses Next.js App Router (`apps/web/src/app/(app)`).
- **`App.tsx` Mega-file**: Discarded. The 300+ line layout must be cleanly separated into Next.js `layout.tsx`, `page.tsx`, and granular components in `src/components/`.
- **Hardcoded State**: The `useState` and static `defaultData` object are discarded in favor of TanStack Query hooks hitting AMBURAX APIs.
- **Client-Side Routing Assumptions**: The Figma code simulates navigation via state (`activeNav`). We will use Next.js `<Link>` and `next/navigation` `usePathname()`.

## 2. App Shell Strategy

The App Shell (`<aside>` Sidebar + `<header>` Topbar) in Figma will become the foundation of the AMBURAX authenticated layout.

**Implementation**:
`apps/web/src/app/(app)/layout.tsx` will be rebuilt using the Figma HTML structure as a template:
- `<AppSidebar>`: Extracted from `<aside>`. Will read `usePathname()` to highlight active routes.
- `<AppHeader>`: Extracted from `<header>`. Will contain:
  - `<StoreSwitcher>`: Context-aware store selection.
  - `<GlobalSearch>`: Command palette trigger.
  - `<UserMenu>`: Extracted from the top-right profile block.

## 3. Frontend Implementation Roadmap

Using the Figma dashboard as the visual anchor, this is the authoritative sequence for rebuilding the post-login AMBURAX frontend.

1. **F1 Design Tokens**: Establish `tailwind.config.ts` (or CSS variables for TW v4) mapped to the audited colors/fonts.
2. **F2 Core UI Primitives**: Build `<Button>`, `<Input>`, `<Badge>`, `<Card>`, `<Select>`, `<Table>` using the new visual language.
3. **F3 App Shell**: Implement `layout.tsx`, Sidebar, Header, and responsive behavior (mobile drawers).
4. **F4 Dashboard**: Build the dashboard page, wiring up existing APIs (Recent Sales) and stubbing unavailable metrics with empty states.
5. **F5 Products/Catalog**: Apply the visual language to the product listing and creation flows.
6. **F6 Inventory**: Adapt inventory receipt and adjustment screens.
7. **F7 Customers**: Apply styling to customer management.
8. **F8 Sales**: Update the sales ledger and receipt viewer.
9. **F9 POS**: Redesign the actual point-of-sale interface (which must remain highly optimized for speed/touch).
10. **F10 Wholesale**: Update B2B commerce screens.
11. **F11-F16 (Advanced Capabilities)**: Procurement, Manufacturing, Job Work, Commerce, Finance, AI.
12. **F17 Mobile/PWA**: Ensure all screens work as an installable PWA for on-floor staff.
13. **F18 Performance Hardening**: Final optimization (caching, streaming, bundle size).

## 4. Unresolved Questions & Risks

- **Chart Library Size**: Recharts is included in the Figma source. We must evaluate its bundle size impact vs lighter alternatives or ensure it is heavily code-split / lazy-loaded so it doesn't degrade POS loading time.
- **Missing Projections**: The Dashboard relies heavily on aggregated statistics (Total Sales, Hourly Sales) that AMBURAX backend does not currently expose. We will need to either implement these backend projection endpoints or gracefully omit the charts in F4.
