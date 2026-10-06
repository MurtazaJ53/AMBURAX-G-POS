# AMBURAX — Full UI Stabilization Report

**Date:** 2026-10-04
**Scope:** POS modernization (`ui-ux-pro-max` + `ecc:motion-ui`), checkout panel corrections, and the D11 dashboard runtime regression.
**Status:** **D11 FIXED — DASHBOARD LIVE QA PASS**

> This file did not previously exist; the prior pass is recorded in
> `UI-CORRECTION-PASS-F8-F12.md` (defects D1–D10). This report continues that
> numbering with D11 and adds the POS work done in the same session.

---

## D11 — Dashboard runtime ReferenceError: `formatAxisMoney is not defined`

**Severity:** HIGH — crashed the Sales Trend chart on the post-login landing screen.
**File:** `apps/web/src/components/dashboard/SalesTrendCard.tsx`
**Commit:** **`eeca985`** — `fix(dashboard): restore sales trend currency formatter`

### Root cause

The Y-axis tick renderer at line 61 called `formatAxisMoney(...)`, but the import on line 4
pulled in only two of the three symbols it needed:

```ts
// before
import { TREND_RANGES, type TrendRange } from "@/server/dashboard/dashboardTransforms";
```

The function was never missing. It is defined and exported at
`apps/web/src/server/dashboard/dashboardTransforms.ts:268`:

```ts
export function formatAxisMoney(minor: number): string {
  const major = Math.round(minor / 100);
  if (Math.abs(major) >= 10_000_000) return `₹${(major / 10_000_000).toFixed(1)}Cr`;
  if (Math.abs(major) >= 100_000)    return `₹${(major / 100_000).toFixed(1)}L`;
  if (Math.abs(major) >= 1_000)      return `₹${Math.round(major / 1_000)}K`;
  return `₹${major}`;
}
```

`apps/web/src/components/charts/TrendChart.tsx:4` already imports it from that exact path, so
the import specifier was proven correct before any change was made.

**This arrived from a concurrent session.** The axis renderer was rewritten from a bare
`toFixed(1)k` number to a call to the project formatter, and the import line was not updated to
match. The intent was right; one line was missing.

### Fix

The smallest correct change — the missing named import:

```ts
// after
import { TREND_RANGES, formatAxisMoney, type TrendRange } from "@/server/dashboard/dashboardTransforms";
```

**Deliberately not done:** no second formatter was written, no `₹` was hardcoded into
individual ticks, no optional chaining or fallback value was used to mask the error, and no
`$` was introduced. The existing authoritative AMBURAX formatter is reused, exactly as
`TrendChart.tsx` already does.

The commit carries both hunks in the file because they are one change: the renderer that calls
the formatter, and the import that makes it resolve. Either alone is broken.

**Signature verified:** `formatAxisMoney(minor: number): string` — integer **minor** units in.
The call site passes `Math.round(tick * 100)`, converting major → minor correctly.

### Live browser verification

`http://localhost:3000/dashboard`, against the already-running server (no second server started).

| Check | Result |
|---|---|
| `formatAxisMoney is not defined` | **Gone** — absent from page text and page errors |
| Next.js runtime error overlay | **None.** The `nextjs-portal` element present in the DOM is Next's dev-tools indicator — its shadow root contains Bootstrap Reboot CSS, not an error |
| Dashboard renders completely | Yes — greeting, KPI row, Sales trend, categories, payments, recent sales |
| Sales Trend chart renders | Yes |
| Y-axis labels, real data (range = 7 days) | **`₹71K · ₹53K · ₹35K · ₹18K · ₹0`** |
| INR formatting correct | Yes — lakh/crore-aware, project formatter |
| `$` anywhere on page | **No** |
| Page errors | **0** |
| Console errors | 1, pre-existing: `404 /images/products/casual-crossbody-bag.jpg` |

On the "Today" range the axis renders no ticks because today has no sales yet — correct
behaviour, not a regression. Switching the range proves the formatter against live figures.

### Regression check

| Route | Status | Rendered | Page errors |
|---|---|---|---|
| `/dashboard` | 200 | yes | 0 |
| `/products` | 200 | yes | 0 |
| `/inventory` | 200 | yes | 0 |
| `/pos` | 200 | yes | 0 |
| `/sales` | 200 | yes | 0 |
| `/sales/[id]` | 200 | yes | 0 |

### Responsive dashboard

| Width | Horizontal overflow | Trend chart |
|---|---|---|
| 1536 × 1024 | **0 px** | renders |
| 1280 × 1024 | **0 px** | renders |
| 900 × 1024 | **0 px** | renders |
| 390 × 844 | **0 px** | renders |

No runtime crash at any width; the header still wraps correctly (the D3 fix from the previous
pass holds).

### Test gates

| Gate | Test Files | Tests | Failed | Skipped | Exit |
|---|---|---|---|---|---|
| `npm run test` | **41 passed (41)** | **581 passed (581)** | 0 | 0 | **0** |
| `npm run test:integration` | **19 passed (19)** | **540 passed (540)** | 0 | 0 | **0** |
| `npm run typecheck` | n/a | n/a | 0 errors | n/a | **0** |
| `npm run lint` | n/a | n/a | 0 errors, 8 warnings | n/a | **0** |
| `npm run build` | 67/67 static pages | n/a | 0 | n/a | **0** |

Integration duration 207.08s. Counts unchanged from the established baseline (581 / 540); no
test was modified.

**One honest note on typecheck:** it first failed on `.next/dev/types/routes.d.ts` and
`validator.ts` — generated files truncated when the dev server was stopped mid-write. Those
were **not** edited; `npm run build` regenerated them, after which typecheck exits 0 with zero
errors in `src/`.

---

## POS modernization (`ui-ux-pro-max` + `ecc:motion-ui`)

### Design direction

`ui-ux-pro-max --design-system` classified this product as **Data-Dense Dashboard** — multiple
widgets, data tables, KPI cards, minimal padding, maximum data visibility — with primary
`#3B82F6`, background `#F8FAFC`, text `#1E293B`. That is the palette AMBURAX already uses, so
the work was **elevation of the existing system, not replacement**. Prescribed effects: row
highlighting on hover, smooth filter animations, loading states.

### The finding that explained the static feel

`tailwindcss-animate` is **not installed** and `tailwind.config.ts` has `plugins: []`. The
`animate-in fade-in zoom-in duration-200` classes on the sale-success modal were therefore
**inert — rendering no animation at all**.

### Motion layer — zero dependency, by choice

`motion` / `framer-motion` were **not** installed. A till is latency-sensitive and the motion
skill's own rule is *responsiveness over smoothness*, so the layer is CSS in `globals.css`:
compositor-only, no bundle cost, no runtime scheduler, no hydration surface.

Two hard constraints, both verified:

1. **Only `transform` and `opacity` animate** — never width/height/top/left, which would force
   layout and jeopardise the F8 geometry gates.
2. **Every animation sits inside `prefers-reduced-motion: no-preference`**, with an explicit
   `reduce` block that withdraws transform, transition and animation.

Tokens: `--amb-ease-smooth`, `--amb-ease-sharp`, durations 140 / 190 / 260 ms.
Classes: `.amb-pop-in`, `.amb-fade-in`, `.amb-line-in`, `.amb-lift`, `.amb-press`,
`.amb-skeleton`, `.amb-focus`.

### Changes and verification

| Change | Verified |
|---|---|
| Catalogue tiles — hover lift, press feedback, focus ring, `aria-label` | computed `matrix(1, 0, 0, 1, 0, -2)` = real `translateY(-2px)`; 30/30 labelled |
| Cart lines slide in on add | `.amb-line-in` present after add |
| Sale-success modal entrance (replacing the dead classes) | 4 `amb-*` keyframes registered in the live stylesheet |
| Loading skeletons while searching | grid no longer renders blank mid-search |
| Category chips `<div>` → `<button>` | were **keyboard-unreachable** despite `cursor-pointer` |
| Stock badge: three states, not two | `null` stock said *"Out of stock"* — untrue. Now *"Stock unknown"* |
| Empty cart states what to do next | *"Scan a barcode or pick a product to start a sale."* |
| Spinner on Complete Sale | a stalled network previously looked identical to a frozen till |
| Icon buttons without accessible names | **3 → 0** (POS view toggles, shell search trigger) |
| Cart delete icon contrast | `slate-300` → `slate-400` |
| **Reduced motion** | `transform: none`, `transitionDuration: 0s` |
| **F8 geometry** | **0 px overflow at 1536 / 1280 / 900 / 390** |

Page errors: **0**.

---

## Checkout panel corrections

Raised from a screenshot of the live panel. Three real defects, all confirmed in code.

### C1 — the same figure shown twice

`Items (1)` rendered `subtotalMinor` and `Subtotal` rendered `subtotalMinor - discountMinor`.
With no discount those are identical — the panel showed **₹1,338.39 twice** under two names and
left the cashier to work out they were the same number. The `Subtotal` row now renders only
when a discount actually exists.

### C2 — "Balance —" was ambiguous

"Balance" reads as *owing*, and a dash communicates nothing. The row now follows the money, with
the label and the colour both carrying the meaning and an `aria-live` announcement:

| Tendered against ₹1,499.00 | Renders |
|---|---|
| nothing entered | `Change due` · `Enter amount` |
| ₹1,000 | **`Short by ₹499.00`** (rose) |
| exact | **`Exact — no change ₹0.00`** |
| ₹1,599 | **`Change due ₹100.00`** (emerald) |

All four states verified in the live browser.

### C3 — the placeholder looked like a value

`Amount Received` used the exact total (`₹1,499.00`) as its grey placeholder, so an empty field
appeared to already hold the right amount. Now `0.00`, with the total one tap away on `Exact`.

Also added: press feedback and focus rings on all four quick-amount buttons (`+1`, `+10`,
`+100`, `Exact`).

---

## Git state

```
eeca985  fix(dashboard): restore sales trend currency formatter   <- D11, committed
64e04ce  fix(ui): correct F8-F12 visual and text consistency      <- previous pass
```

`eeca985` touches exactly one file, `SalesTrendCard.tsx`, with nothing unrelated staged. No
`git add .` was used; no history was rewritten.

**The POS modernization and checkout corrections are not yet committed.** A concurrent session
has been editing this working tree throughout — 12+ files not authored here
(`AppHeader`, `AppSidebar`, `BusinessCards`, `OperationsCards`, `ProductDetailPanel`,
`CatalogMobileFilters`, `InventoryDetailPanel`, `inventory/page`, `products/page`,
`VariantForm`, `variants/new/page`, `dashboard/page`) are modified alongside them. Committing
the POS work would require separating it from theirs mid-flight, which is the owner's call.

One courtesy fix was made in their territory and is disclosed here: `SalesWorkspace.tsx:205`,
where a `<button>` had been changed to a `<Link>` with an untyped `(e)` handler that broke
`noImplicitAny`. Only the type annotation `(e: React.MouseEvent)` was added; no logic touched.

---

## Accepted pre-existing findings (owner decision, 2026-10-04)

Two `gray-on-color` design-hook findings in `apps/web/src/app/(app)/pos/PosTerminal.tsx`,
both marked `attribution unknown` and both pre-dating this work. The owner reviewed them and
ruled **leave as-is**. They are recorded here rather than suppressed in tooling, so they stay
visible on future scans instead of being silently filtered out.

| Line | Element | Why accepted |
|---|---|---|
| ~950 | Cart-row delete **icon** button, `text-slate-400` on white, darkening to `rose-500` on hover | Colours an icon, not text. Non-text UI components answer to the 3:1 threshold, not 4.5:1. |
| ~1013 | `ActionBtn` **disabled** state, `text-slate-400` on `bg-slate-50` with `opacity-60` | WCAG 1.4.3 explicitly exempts inactive components from contrast minimums. Muting disabled controls is how this app signals unavailability, including the `Hold Bill` / `Retrieve Bill` buttons that must stay visibly inert until F13. |

**No ignore rule was persisted** — `impeccable hooks ignore-value` was not run for either, per
the owner's instruction. Line numbers are approximate and will drift as the file changes.

Two earlier findings on the same rule were genuinely resolved rather than accepted: the cart
delete icon moved `slate-300 → slate-400`, and the category-chip icon `slate-400 → slate-500`
when those `<div>`s became buttons. The rule's count on this file went 4 → 2 as a result.

---

## Remaining known issues

1. **Uncommitted POS work** — motion layer and checkout corrections, pending separation from the
   concurrent session's changes.
2. **ERP wording differs across three screens** (`Unposted (ERP)` / `Pending Sync` /
   `ERP sync pending`) — all truthful; the canonical term is an owner decision.
3. **`404 /images/products/casual-crossbody-bag.jpg`** — pre-existing seed-asset gap.
4. **8 lint warnings** — pre-existing `<img>` usage and unused eslint-disable directives.
5. **True 90% browser zoom** remains a separate manual check; CSS zoom was not used to simulate
   it.

---

## FINAL

# D11 FIXED — DASHBOARD LIVE QA PASS

The dashboard was rechecked live before this status was claimed: it renders in full, the Sales
Trend chart draws, the Y-axis reads `₹71K · ₹53K · ₹35K · ₹18K · ₹0` from the project's own INR
formatter, and there are zero runtime page errors. All five gates exit 0 with test counts
unchanged. Six routes and four viewport widths show no regression.
