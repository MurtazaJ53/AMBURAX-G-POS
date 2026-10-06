# AMBURAX — UI Correction Pass (F8 → F12)

**Date:** 2026-10-03
**Type:** Correction / QA pass. Not a feature phase. **F13 not started.**
**Baseline HEAD:** `ed3af85`
**Outcome:** **UI CORRECTION PASS — GREEN**

---

## 1. Scope

Fixed the seven defects from `LOCALHOST-CHROME-QA-REPORT.md` (D1–D7), and ran the full
text / currency / encoding / copy audit over the ten implemented F8–F12 screens at four
widths. The audit turned up **three further defects** not in the original list; all three are
fixed and recorded below as D8–D10.

No screen was redesigned, no architecture changed, no F9 payment semantics touched, no F10
behaviour altered, no schema change, no reseed, no commit.

---

## 2. Defects fixed

### D1 — HIGH · Logged-out bill link 404'd

`apps/web/src/app/(app)/sales/[id]/page.tsx:41` and `:44` redirected to `/login`, a route that
does not exist. Every other protected page uses `/auth/login`.

| | Before | After |
|---|---|---|
| Logged-out `/sales/{id}` | `/login` → **404** | `/auth/login` → **200** |
| Sign-in form present | no | **yes** |
| Bill number leaked | no | no |
| HTTP 4xx during the check | `404 /login` | **none** |

Both guards are unchanged — only the destination string. Authentication was not weakened:
`!token` and `ctx.status !== "ok"` still gate the page, and a foreign sale id still 404s.

### D2 — MEDIUM · `/sales/[id]` exceeded viewport width

The page container was `mx-auto max-w-7xl …` with **no `w-full`**, so it sized to its content
instead of to the track beside the shell sidebar.

| Width | Before | After |
|---|---|---|
| 1280 | scrollWidth **1464** (+184 px) | **1280** (0) |
| 390 | scrollWidth **814** (+424 px) | **390** (0) |

Fixed by adding `w-full min-w-0`, the pattern the inventory forms already use
(`mx-auto w-full max-w-4xl`).

**Not solved by hiding content.** The items and payments tables sit in `.amb-table-wrap`
(`overflow-x: auto`) and were measured actively scrolling after the fix — `scrollWidth 780`
vs `clientWidth 356`, with `scrollLeft` reaching **424**. Every column (`PRICE`, `DISCOUNT`,
`TAX`, `TOTAL`, `REFERENCE NO.`, `STATUS`) remains reachable.

### D3 — MEDIUM · `/dashboard` overflowed at 390

The header action row was a single non-wrapping flex line.

| | Before | After |
|---|---|---|
| 390 scrollWidth | **559** (+169 px) | **390** (0) |

Fixed with `flex-wrap` on the outer and inner rows plus `gap-y-3`, and the date divider's
border now applies from `sm:` up so it does not dangle when the row wraps. No transforms, no
page-wide zoom, no global CSS hack.

### D4 — LOW · `/sales` tab row overflowed at 390

`.tabs-scroll` carried `margin-right: -10px; padding-right: 10px` — a bleed trick whose
negative margin became page-level overflow.

| | Before | After |
|---|---|---|
| 390 scrollWidth | **400** (+10 px) | **390** (0) |

Now `overflow-x: auto; min-width: 0; max-width: 100%`. The tabs still scroll inside their own
container; `min-width: 0` is what lets a flex child shrink below its content width so that
container can actually do its job.

### D5 — LOW · Returns controls were styled-disabled only

`SalesWorkspace.tsx:163` had `opacity-50 cursor-not-allowed` and `title="Future Feature"` but
no `disabled` attribute — focusable by keyboard, announced as an ordinary button.

**The QA report named one control; there were two.** `SalesWorkspace.tsx:300` carried an
identically fake-disabled `Return` button in the transaction inspector. Both now have
`disabled` + `aria-disabled="true"`, and the tooltip reads "Returns are not available yet"
rather than the developer-facing "Future Feature".

Verified after the fix: both appear in the browser's genuinely-disabled set.
**Returns was not made functional.**

### D6 — MEDIUM · `/products/[id]` rendered dollars

`products/[id]/page.tsx:93` hardcoded `` `$${(v.priceMinor / 100).toFixed(2)}` ``.

| | Before | After |
|---|---|---|
| Variant prices | `$1349.00`, `$1299.00` | **`₹1,349.00`, `₹1,299.00`** |

Now uses the shared `formatMinor` helper, so the screen matches every other surface including
en-IN grouping. **Whole-screen audit done:** the file contains four `$` characters in total;
the other three are `${}` template interpolations. This was the only currency symbol, and the
only hardcoded `$` anywhere in the products area.

`VariantForm.tsx` also uses `toFixed(2)`, but for `defaultValue` on numeric inputs where the
operator types major units and no symbol is rendered — correctly left alone.

### D7 — LOW · Stock forms had no page heading

`/inventory/receipts/new` and `/inventory/adjustments/new` returned 200 and rendered their
forms with **no `h1`**.

Both already displayed a correct visible title via `CardTitle`, which renders `<h3>`. Rather
than add a second heading, `CardTitle` gained an **optional** `as?: "h1" | "h2" | "h3"` prop
defaulting to `"h3"` — so all existing call sites render byte-identically — and the two forms
opt in with `as="h1"`.

| Route | Before | After |
|---|---|---|
| `/inventory/receipts/new` | `h1: []` | **`h1: ["Receive Stock"]`** |
| `/inventory/adjustments/new` | `h1: []` | **`h1: ["Adjust Stock"]`** |

**No duplicate visible heading** — the existing title simply became the `h1`.

---

## 3. Additional defects found by the audit

### D8 — MEDIUM · Mojibake in bill-details table headers

Five headers on `/sales/[id]` rendered a literal `(?)`: `Price (?)`, `Discount (?)`,
`Tax (?)`, `Total (?)`, `Amount (?)`. The source contained the `?` verbatim — a `₹` that did
not survive an encoding step.

Determined rather than assumed, as instructed: every cell beneath these headers renders
`formatMinor(...)`, which emits INR. Restored to `Price (₹)` … `Amount (₹)`.

Verified live: headers now read `PRICE (₹) · DISCOUNT (₹) · TAX (₹) · TOTAL (₹) · AMOUNT (₹)`,
and a page-wide regex for `(?)` returns **false**.

**Repo-wide encoding sweep, all clean:**

| Pattern | Result |
|---|---|
| `(?)` in `.ts`/`.tsx` | 0 (the one match is my own explanatory comment) |
| U+FFFD replacement character | 0 |
| Mojibake rupee (`â‚¹`, `Ã¢`) | 0 |
| Mojibake smart quotes (`â€™`, `â€œ`) | 0 |

### D9 — MEDIUM · Three dead buttons on `/dashboard`

*Add Item*, *Receive Stock* and *Generate Report* were `<button>` elements with real labels
and **no `onClick`** — pressing them did nothing. That is the "dead action text" §1D forbids.

All three destinations already exist, so each became a `<Link>` to the screen it names:

| Label | Now navigates to |
|---|---|
| Add Item | `/products/new` |
| Receive Stock | `/inventory/receipts/new` |
| Generate Report | `/reports` |

Route existence was confirmed before wiring. **No new functionality was invented** — the
buttons now go where their labels always claimed.

### D10 — LOW · `/pos` had no `h1`

The till is a full-bleed workstation with no title bar and carried no page heading at all, so
assistive technology announced the document with nothing to name it.

Added `<h1 className="sr-only">Point of Sale — {storeName}</h1>`. Visually hidden deliberately:
a drawn title would change a layout F8 settled. Verified: `h1: ["Point of Sale — Main Store"]`.

---

## 4. Files changed

Nine source files, **+88 / −33**.

| File | Defect | Change |
|---|---|---|
| `app/(app)/sales/[id]/page.tsx` | D1, D2, D8 | redirect target ×2; `w-full min-w-0`; five `₹` headers |
| `app/(app)/dashboard/page.tsx` | D3, D9 | `flex-wrap` ×2; three buttons → links |
| `app/globals.css` | D4 | `.tabs-scroll` negative margin removed |
| `app/(app)/sales/_components/SalesWorkspace.tsx` | D5 | `disabled` + `aria-disabled` ×2 |
| `app/(app)/products/[id]/page.tsx` | D6 | `$…toFixed` → `formatMinor`; import added |
| `components/ui/card.tsx` | D7 | optional `as` prop, default `h3` |
| `app/(app)/inventory/receipts/new/ReceiveStockForm.tsx` | D7 | `CardTitle as="h1"` |
| `app/(app)/inventory/adjustments/new/AdjustStockForm.tsx` | D7 | `CardTitle as="h1"` |
| `app/(app)/pos/PosTerminal.tsx` | D10 | `sr-only` `h1` |

No backend, service, query, schema or test file was modified.

---

## 5. Responsive results — after fixes

Measured as `document.documentElement.scrollWidth − clientWidth`. **Zero** means no
page-level horizontal overflow.

| Screen | 1536 | 1280 | 900 | 390 |
|---|---|---|---|---|
| `/dashboard` | 0 | 0 | 0 | **0** (was +169) |
| `/products` | 0 | 0 | 0 | 0 |
| `/products/[id]` | 0 | 0 | 0 | 0 |
| `/inventory` | 0 | 0 | 0 | 0 |
| `/inventory/movements` | 0 | 0 | 0 | 0 |
| `/inventory/receipts/new` | 0 | 0 | 0 | 0 |
| `/inventory/adjustments/new` | 0 | 0 | 0 | 0 |
| `/pos` | 0 | 0 | 0 | 0 |
| `/sales` | 0 | 0 | 0 | **0** (was +10) |
| `/sales/[id]` | 0 | **0** (was +184) | 0 | **0** (was +424) |

**40 of 40 cells clean.** Visual inspection of `/dashboard` at 390 shows the action buttons
wrapping onto two rows with no clipping; `/sales/[id]` at 390 fits with its tables scrolling
inside their cards.

---

## 6. Accessibility results

| Check | Result |
|---|---|
| `h1` on every audited screen | **10 / 10** (was 7 / 10) |
| Semantic disabled states | `Returns`, `Return` now in the genuine disabled set |
| Pre-existing genuine disabled controls | `Import`, `Export`, `Hold Bill (F3)`, `Retrieve Bill (F4)`, `New Customer (F5)`, `Apply Offer (F6)`, `Sales Person (F7)`, `Edit`, `View Session` — already correct |
| Sale Success dialog (F10) | `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trapped — unchanged |
| Bill-details tables | real `<table>` with `<th>`; horizontally scrollable, not clipped |
| Heading duplication | none introduced — the forms' existing titles became their `h1` |

### Design-hook findings left standing (not suppressed)

Three `gray-on-color` findings in `PosTerminal.tsx` (≈ L542, L807, L864), all marked
`attribution unknown` and all pre-existing F8/F9 code:

- **L542** product-tile image placeholder — colours an **icon**, not text, on `bg-slate-50`.
- **L807** cart-line delete **icon** button — darkens to `rose-500` on hover.
- **L864** `ActionBtn` **disabled** state — WCAG 1.4.3 explicitly exempts inactive components
  from contrast minimums, and muting disabled controls is how the whole app signals
  unavailability.

Read as rule misfires (icons, and an exempt disabled state, on a near-white ground rather than
a colour). Nothing was suppressed — persisting ignores on code this pass does not otherwise
touch is the owner's call.

---

## 7. Cross-screen terminology audit

Consistent and correct across `/pos`, `/sales`, `/sales/[id]`, `/dashboard`, `/inventory`:

| Aspect | Finding |
|---|---|
| Currency | `₹` with en-IN grouping everywhere **after D6 and D8**. Lakh grouping (`₹2,68,738.00`) is correct for the locale. |
| Customer | `Walk-in` used identically on `/sales` and `/sales/[id]` |
| Payment | `CASH` / `UPI` / `CARD` consistently; `/sales` renders a split as **`CASH + UPI`** |
| Status | `Completed` / `Voided` consistent |
| Date & time | One `formatDateTime` helper, en-IN, `Asia/Kolkata`, identical on every screen |
| Bill vs Invoice | `Bill No.` for the AMBURAX reference throughout; "Invoice" appears only in ERP-sync context, never as a bill label |

### One inconsistency reported, deliberately not changed

ERP state is worded three ways:

| Screen | Wording |
|---|---|
| `/sales` | `Unposted (ERP)` (KPI tile), `ERP Sync: PENDING` (inspector) |
| `/sales/[id]` | `POS Invoice` / `Pending Sync`, status pill `Pending` |
| `/pos` (F10) | `ERP sync pending` |

**All three are truthful** — none claims a post that has not happened, and `ERPNext Invoice`
still renders `-` rather than a fabricated number. They were left alone because each suits its
slot (a KPI tile needs a short noun; a detail field needs a value), and because choosing the
canonical term is a terminology decision the brief says not to make silently. **Flagged for the
owner**, not a blocking defect.

Related, non-blocking: `sales/[id]/page.tsx:53` tests `erpSyncStatus === "POSTED"` and
`=== "SUCCESS"`, neither of which exists in the `ErpSyncStatus` enum (`PENDING | SYNCED |
FAILED`). Dead comparisons; harmless, since the `SYNCED` branch is what actually fires.

---

## 8. Functional regression

Verified against the **existing** transaction. **No new sale was created.**

| Check | Result |
|---|---|
| `/sales` row for `MAIN-000092` | `3 Oct 2026, 4:59 pm · MAIN-000092 · Walk-in · 2 · ₹2,998.00 · CASH + UPI · Completed` — unchanged |
| Split representation | still `CASH + UPI`, not `CASH` |
| `/sales/[id]` payments | both rows, `UPI/QA-LOCALHOST-001` reference intact |
| Print (bill details) | `window.print()` invoked once |
| POS catalogue | 36 tiles |
| POS payment methods | Cash, UPI, Card, Split, More — all present |
| `Hold Bill (F3)` / `Retrieve Bill (F4)` | still `disabled` — **F13 untouched** |
| Protected routes logged out | redirect to `/auth/login`, no content leak |

F9 payment semantics, F10 success behaviour and F11 sales logic were not modified.

---

## 9. Console / network

| Category | Result |
|---|---|
| Page errors | **0** |
| Hydration errors | **0** |
| Failed requests | **0** |
| New warnings from this pass | **0** |
| HTTP ≥ 400 | 1 distinct, pre-existing |

```
404 /images/products/casual-crossbody-bag.jpg
```

Pre-existing seed-asset gap: the demo catalogue references a product image absent from
`public/`. Documented in `F10-IMPLEMENTATION-REPORT.md` §12 and `LOCALHOST-CHROME-QA-REPORT.md`
§22. Unrelated to this pass, and not introduced by it.

---

## 10. Test gates

Run sequentially with the dev server stopped. **No test was modified.**

| Gate | Test Files | Tests | Failed | Skipped | Duration | Exit |
|---|---|---|---|---|---|---|
| `npm run test` | **41 passed (41)** | **581 passed (581)** | **0** | **0** | 9.79 s | **0** |
| `npm run test:integration` | **19 passed (19)** | **540 passed (540)** | **0** | **0** | **148.44 s** | **0** |
| `npm run typecheck` | n/a | n/a | **0 errors** | n/a | — | **0** |
| `npm run lint` | n/a | n/a | **0 errors**, 8 warnings | n/a | — | **0** |
| `npm run build` | 67/67 static pages | n/a | **0** | n/a | 10.6 s compile | **0** |

Counts are **identical to the pre-pass baseline** (581 / 540) — nothing was broken, and no test
was added or skipped to force green. Integration ran in 148 s, consistent with the repaired
infrastructure (down from 1013 s before that fix).

The 8 lint warnings are **the same 8 as before this pass**: `@next/next/no-img-element` and
unused eslint-disable directives in `inventory/movements/page.tsx`, `inventory/page.tsx`,
`sales/_components/SalesWorkspace.tsx` and `components/inventory/InventoryDetailPanel.tsx`.
This pass introduced none.

---

## 11. Git state

**Before:**
```
 M apps/web/next-env.d.ts
 M apps/web/test-integration.out
 M apps/web/test.out
?? (F13 artifacts, INTEGRATION-INFRASTRUCTURE-REPORT.md, LOCALHOST-CHROME-QA-REPORT.md)
```

**After — nine intended source files added to the modified set:**
```
 M apps/web/src/app/(app)/dashboard/page.tsx
 M apps/web/src/app/(app)/inventory/adjustments/new/AdjustStockForm.tsx
 M apps/web/src/app/(app)/inventory/receipts/new/ReceiveStockForm.tsx
 M apps/web/src/app/(app)/pos/PosTerminal.tsx
 M apps/web/src/app/(app)/products/[id]/page.tsx
 M apps/web/src/app/(app)/sales/[id]/page.tsx
 M apps/web/src/app/(app)/sales/_components/SalesWorkspace.tsx
 M apps/web/src/app/globals.css
 M apps/web/src/components/ui/card.tsx
?? UI-CORRECTION-PASS-F8-F12.md
```

No `git add .`, nothing staged, no commit, no history rewritten. `SCREENS/`, the F13 artifacts,
the integration-infrastructure report, the QA report and every pre-existing untracked file were
left untouched. `next-env.d.ts`, `test.out` and `test-integration.out` are generated artifacts
already modified before this pass began.

---

## NO-BLOCKING-UI-TEXT-DEFECTS

The audit establishes this, and the evidence is specific rather than asserted:

- **Encoding:** `(?)` mojibake found on five bill-details headers and fixed. Repo-wide sweeps
  for `(?)`, U+FFFD, mojibake rupee and mojibake smart quotes all return zero.
- **Currency:** the single hardcoded `$` is gone. Every money value on all ten screens renders
  `₹` with en-IN grouping; minor→major conversion verified against the database
  (`260873` → `₹2,608.73`, `38927` → `₹389.27`, `134900` → `₹1,349.00`). Zero amounts render
  honestly as `₹0.00`, including the discount column where the data is zero.
- **Action labels:** no dead control remains. Three inert dashboard buttons now navigate to the
  screens they name; two fake-disabled Returns controls are genuinely disabled.
- **Placeholder / prototype copy:** none on the audited screens. The only "Coming soon" string
  in the codebase is in `OnboardingCompleteView.tsx`, an onboarding screen outside F8–F12,
  used as a legitimate capability chip.
- **Fabricated data:** none. ERP invoice renders `-`; the Returns analytics row renders
  `0 · N/A` with an empty bar rather than inventing a figure.
- **Literal `undefined` / `null` / `NaN` in rendered text:** none on any audited screen.
- **Responsive text:** no clipping, no overlap, no unreadable labels at any of the four widths;
  wide tables scroll inside their own containers with all columns reachable.

The one open item — three different ERP phrasings (§7) — is a consistency observation, not a
text defect: every phrasing is accurate, and settling on one is a terminology decision for the
owner.

---

## 12. Remaining known issues

1. **ERP wording differs across three screens** (§7). All truthful. Owner's call.
2. **Dead enum comparisons** at `sales/[id]/page.tsx:53` (`"POSTED"`, `"SUCCESS"` are not in
   `ErpSyncStatus`). Harmless.
3. **`404 /images/products/casual-crossbody-bag.jpg`** — pre-existing seed-asset gap.
4. **`/sales/export` dead link** at `sales/page.tsx:93` — pre-existing F7 defect, recorded in
   `F10-SALE-SUCCESS-DESIGN-AUDIT.md` §4. Outside this pass's named scope; not touched.
5. **8 lint warnings** — pre-existing `<img>` usage and unused eslint-disable directives.
6. **Three design-hook contrast findings** in pre-existing POS code (§6). Left standing.
7. **`Sale.paidMinor` always equals `totalMinor`** — F9 data-model limitation, documented in
   `F10-IMPLEMENTATION-REPORT.md` §4.1. Unchanged by design.
8. **True 90% browser zoom** remains a separate manual check; CSS zoom was not used to
   simulate it.

---

## FINAL STATUS

# UI CORRECTION PASS — GREEN

**Ten defects fixed:** the seven from QA (D1–D7) plus three the audit surfaced (D8 mojibake
headers, D9 dead dashboard buttons, D10 missing POS `h1`). D5 turned out to cover two controls,
not one.

**GREEN is claimed against the stated bar — no visible text, encoding, currency or overflow
defect remains:**

- Overflow: **40 of 40** screen × width cells measure zero page-level horizontal overflow.
- Encoding: four repo-wide sweeps return zero.
- Currency: one `₹` format everywhere, verified against database minor units.
- Text: no dead actions, no placeholder copy, no fabricated values, no literal
  `undefined`/`null`/`NaN`.
- Accessibility: `h1` on 10 of 10 screens; both fake-disabled controls now semantically
  disabled.

**Nothing was broken proving it:** 581 unit and 540 integration tests pass with counts
unchanged, typecheck and lint are error-free with the warning count identical to before, the
build compiles 67/67 pages, and the existing split sale still reads `CASH + UPI · ₹2,998.00`
end to end.

The single open consistency item (ERP phrasing) is flagged rather than silently resolved,
because picking the canonical term is the owner's decision, not this pass's.

**F13 was not started. No commit was made.**
