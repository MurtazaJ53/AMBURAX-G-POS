# AMBURAX — Localhost Chrome QA Report (F8 → F12)

**Date:** 2026-10-03
**Scope:** Real-browser verification of the running localhost application, F8 through F12.
**Outcome:** **LOCALHOST QA — DEFECTS FOUND** (6 defects; none blocks the core sell-to-receipt flow).

---

## 1. Environment

| Item | Value |
|---|---|
| Repository | `D:\G-POS`, branch `main`, HEAD `f168aca` |
| App | Next.js 16.3.4 (Turbopack), `@amburax/web@0.1.0` |
| Dev server | `npm run dev` (`next dev -H 0.0.0.0`), ready in 877 ms |
| Database | `amburax-postgres` container, **Up 7 hours (healthy)**, `0.0.0.0:55432->5432/tcp` |
| Tenant / store | `Demo Retail Co.` · `Main Store (MAIN)`, Bengaluru, `Asia/Kolkata` |
| Account used | `owner@demo.amburax.test` (existing development account) |
| Data state | Pre-existing development data. **Nothing reset, reseeded or migrated.** |

## 2. Browser

**Chromium 153.0.8010.12** (Playwright-managed `chrome-win64`), driven headless. Real browser engine, real network stack, real DOM geometry — not a simulation. Console, page errors, failed requests and HTTP >= 400 captured throughout.

## 3. Localhost URL

`http://localhost:3000` — bound `0.0.0.0:3000`, PID **33380** at report time (PID 37052 for the first half of the run; the server was deliberately stopped for the static gates in §20 and restarted afterwards).

---

## 4. Login (Phase 1) — PASS

| Check | Result |
|---|---|
| Root redirect | `/` -> **307** -> `/auth/login` |
| Login screen loads | Yes, `<title>Sign in — AMBURAX</title>`, email field present |
| Blank screen | No |
| Page errors / hydration errors | **0** |
| Incorrect credentials | Stays on `/auth/login`; message **"The email or password you entered is incorrect."** — does not disclose which field was wrong |
| Password in URL | **No**, on either the failed or the successful attempt |
| Successful login | -> `/dashboard` |
| Session cookie | `amburax_session`, `httpOnly=true`, `sameSite=Lax`, `path=/`, 64 chars. `secure=false` is correct for `http://localhost` |
| Credential leakage | `localStorage` **empty**, `sessionStorage` **empty** |

## 5. Global shell (Phase 2) — PASS with one defect

Landmarks all present: `header`, `nav`, `main`, `aside`. Navigation renders 13 destinations — Dashboard, POS, Sales, Inventory, Products, Customers, Customer Due (Khata), Suppliers, Offers & Loyalty, Reports, Commerce Overview, AI Command Center, Store & Settings.

| Width | Result |
|---|---|
| 1536 x 1024 | PASS (1536 / 1536) |
| 1280 x 1024 | PASS (1280 / 1280) |
| 900 x 1024 | PASS (900 / 900) |
| 390 x 844 | **FAIL** — scrollWidth 559 vs 390. See **D3** |

## 6. Dashboard (Phase 3) — PASS, data real

Headings: *Good Evening, Demo* · Sales trend · Top categories · Payment methods · Fast-moving products · Low stock signal · Recent sales · Grow Your Business · Store Staff (Shift Live) · Today's Targets.

Figures are database-backed, not fixtures. "Recent sales" showed `MAIN-000091` — the real most-recent sale at the time — and after the QA sale the list reflected `MAIN-000092`. Money renders consistently as `₹` with en-IN grouping (`₹67,757.00`, `₹22,485.00`, `₹2,998.00`…). Zero-valued targets render honestly as `₹0` rather than being hidden.

Responsive: 1536 / 1280 / 900 PASS; 390 **FAIL** (**D3**).

## 7. Products (Phase 4) — PASS with one defect

`/products` renders the real catalogue; prices `₹1,499.00`, `₹1,999.00`, `₹2,499.00`, `₹3,199.00`… No page-level overflow at any of the four widths.

Product detail `/products/cmu9xxsmi0001wnac3cklwwim` -> **200**, `h1 = "Cotton Formal Shirt"`, brand *Amburax Basics*, status Active, and a real variant table:

```
SHIRT-BLU-L   L / Blue    $1349.00   Active
SHIRT-BLU-M   M / Blue    $1349.00   Active
SHIRT-WHT-L   L / White   $1299.00   Active
SHIRT-WHT-M   M / White   $1299.00   Active
```

SKU, size and colour all real. **But the price carries a `$`** — see **D6**. No broken images on the detail page; no overflow at 390.

## 8. Inventory (Phase 5) — PASS

`/inventory` renders 50 rows of real stock. No overflow at any width.

| Route | Status | Notes |
|---|---|---|
| `/inventory/movements` | 200 | 50 movement rows, `SALE` type present |
| `/inventory/receipts/new` | 200 | Form renders; **no `h1`** (minor, **D7**) |
| `/inventory/adjustments/new` | 200 | Form renders; **no `h1`** (minor, **D7**) |

No mutations were created on either form — they were loaded and inspected only, per instruction.

## 9. POS (Phase 6) — PASS

36 catalogue tiles. Payment methods present: Cash, UPI, Card, Split, More. Quick Actions row intact.

**`Hold Bill` `disabled=true` and `Retrieve Bill` `disabled=true`** — correct and consistent with F13 being unimplemented. Neither is a control that silently does nothing.

| Width | scrollWidth / clientWidth | Result |
|---|---|---|
| 1536 | 1536 / 1536 | PASS |
| 1280 | 1280 / 1280 | PASS |
| 900 | 900 / 900 | PASS |
| 390 | 390 / 390 | PASS |

No unexpected desktop page scroll; checkout panel reachable at every width; no overlay collision. **F8 geometry holds.**

## 10. Split payment — F9 (Phase 7) — PASS

Method switching verified for Cash, UPI, Card, More. The amount-received field appears for Cash only, which is correct — the other single tenders take no amount.

**Split gating, step by step:**

| State | Remaining | Complete Sale |
|---|---|---|
| Split selected, nothing entered | `₹2,998.00` | **disabled** |
| CASH `1499` entered (half) | `₹1,499.00` | **disabled** |
| CASH `1499` + UPI `1499` + reference | `—` | **enabled** |

**The outbound request uses `payments[]`** — captured from the live network:

```json
{"idempotencyKey":"b9c99d6d-2546-4e91-8bbd-b128c8bfd203",
 "lines":[{"variantId":"cmu9y4drm009z12ckkbwm1kax","quantity":1},
          {"variantId":"cmu9xxxc0001h2ar3k1zrttzd","quantity":1}],
 "customerId":null,
 "payments":[{"method":"CASH","amountMinor":149900},
             {"method":"UPI","amountMinor":149900,"reference":"UPI/QA-LOCALHOST-001"}]}
```

**No single-CASH fallback.** Two tenders, correct amounts, reference carried.

**Recorded sale:** bill **`MAIN-000092`**, id **`cmusb7j1p000k68casg2vtrop`**, total **₹2,998.00**, payments **CASH ₹1,499.00 + UPI ₹1,499.00** = ₹2,998.00.

One real sale was created, which Phase 7 explicitly permits. No other mutations.

## 11. Sale Success — F10 (Phase 8) — PASS

| Field | Value |
|---|---|
| Heading | `Sale Completed!` |
| Bill number | `MAIN-000092` |
| Total | `₹2,998.00` (header and receipt agree) |
| Item count | `2` |
| Change due | absent — correct, the split settles exactly |
| Discount row | absent — correct, `discountMinor = 0` |
| Customer row | absent — correct, walk-in |
| ERP status | **`ERP sync pending`** |
| Items | `Casual Crossbody Bag · CCB-001 \| Brown · 1 · ₹1,499.00`<br>`Chinos · CHINO-BEG-30 \| 30 / Beige · 1 · ₹1,499.00` |
| Payments | `1. CASH ₹1,499.00` · `2. UPI UPI/QA-LOCALHOST-001 ₹1,499.00` |

SKU, size and colour all render. Controls present: Print, View Bill Details, New Sale, close, copy-bill-number — all five.

**Unsupported controls absent from the DOM** (not hidden, not disabled): invoice number, GSTIN, sales person, Download PDF, WhatsApp, Email Receipt, Return/Exchange — all `false`.

**Print works:** `window.print()` invoked once; under print media `workspace: none`, `close: none`, `receipt: block` — only the receipt prints.

**Accessibility:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby="sale-success-heading"`, focus lands on `success-print`, **0** unlabeled interactive elements.

Responsive 1536 / 1280 / 900 / 390: **all PASS**, no overflow.

## 12. Sales History — F11 (Phase 9) — PASS with one defect

`h1 = "Sales & Transaction History"`. Columns: `#`, Date & Time, Bill No., Customer, Items, Amount, **Payment**, Status, Action.

**The critical check passes.** The row for the split sale:

```
1 | 3 Oct 2026, 4:59 pm | MAIN-000092 | Walk-in | 2 | ₹2,998.00 | CASH + UPI | Completed
```

**`CASH + UPI`, not `CASH`.** Bill number, customer, item count and amount all match the Sale Success screen exactly.

Search works: typing the bill number narrowed 20 rows -> 1 row. Status filter and tabs present (All Transactions / Sales / Voided / Returns).

**Returns handling is honest, with one caveat.** The Returns analytics row is dimmed to `opacity-40` and reads `0 · N/A` with an empty bar — it fabricates nothing. The Returns *tab* is styled as unavailable with `title="Future Feature"`, but is not actually `disabled` — see **D5**.

Responsive: 1536 / 1280 / 900 PASS; 390 **FAIL** (**D4**).

## 13. Bill Details — F12 (Phase 10) — PASS with one defect

Requested `/sales/cmusb7j1p000k68casg2vtrop` -> **200**, `h1 = "Bill Details"`.

**No fallback to the first record.** The only bill number anywhere on the page is `MAIN-000092`. Loading a *different* id (`cmus25cky0006sted0rp3emz3`) renders `MAIN-000091` and does **not** show our bill. Two bogus ids returned **404** and leaked nothing.

| Section | Observed |
|---|---|
| Header | `Completed` · Bill No. `MAIN-000092` · 3 Oct 2026, 4:59 pm · `POS Invoice Pending Sync` |
| Store / session | Store `Main Store (MAIN)`, POS Terminal `-`, Shift `-`, Cashier `Demo Owner` |
| Customer | `Walk-in` |
| Items | `CCB-001 · Brown · 1 · ₹1,499.00 · disc ₹0.00 · tax ₹228.66 · ₹1,499.00`<br>`CHINO-BEG-30 · 30 / Beige · 1 · ₹1,499.00 · disc ₹0.00 · tax ₹160.61 · ₹1,499.00` |
| Payments | `1 · 3 Oct 2026, 4:59 pm · CASH · - · ₹1,499.00 · Success`<br>`2 · 3 Oct 2026, 4:59 pm · UPI · UPI/QA-LOCALHOST-001 · ₹1,499.00 · Success` |
| Summary | Subtotal `₹2,608.73` · GST (Included) `₹389.27` · Grand Total `₹2,998.00` · Amount Paid `₹2,998.00` · Balance Due `₹0.00` |
| ERP | Invoice Status `Pending`, **`ERPNext Invoice -`** — no fabricated number |
| Timeline | `Bill Created` · `Payment Received (CASH) ₹1,499.00` · `Payment Received (UPI) ₹1,499.00` — all timestamp-backed, **no fake ERP-posted event** |
| Print | `Print bill` present and real |

Terminal and Shift show `-` honestly, because `posSessionId` is null on this sale (no shift was open).

Unsupported actions absent: invoice number, GSTIN, sales person, PDF, WhatsApp, email, return/exchange — all `false`.

Responsive: 1536 PASS, 900 PASS; **1280 FAIL** and **390 FAIL** — see **D2**.

## 14. Cross-screen correlation (Phase 11) — PASS

One transaction traced end to end. Every field agrees at every surface.

| Field | POS / Sale Success | `/sales` | `/sales/[id]` | Database |
|---|---|---|---|---|
| Sale ID | `cmusb7j1p000k68casg2vtrop` | link resolves | URL matches | matches |
| Bill number | `MAIN-000092` | `MAIN-000092` | `MAIN-000092` | `MAIN-000092` |
| Total | `₹2,998.00` | `₹2,998.00` | `₹2,998.00` | `299800` |
| Item count | `2` | `2` | `Items (2)` | `unitsSold 2` |
| Customer | none shown | `Walk-in` | `Walk-in` | `null` |
| Payments | `CASH ₹1,499` + `UPI ₹1,499` | `CASH + UPI` | both rows, `Success` | 2 x `CONFIRMED` |
| Reference | `UPI/QA-LOCALHOST-001` | — | `UPI/QA-LOCALHOST-001` | `UPI/QA-LOCALHOST-001` |
| Stock effect | not claimed | — | — | 2 x `SALE -1` |

**Zero mismatches.**

## 15. Database correlation (Phase 12) — PASS

```
bill MAIN-000092   status COMPLETED
totalMinor 299800 | paidMinor 299800 | tendered 299800 | derived change 0
subtotal 260873 | tax 38927 | discount 0
units 2 | customer null | posSessionId null
tenant Demo Retail Co. (69d8eea5-...d345ff) | store Main Store / MAIN | cashier Demo Owner
erpSyncStatus PENDING | erpInvoiceId null
items   CCB-001 qty1 149900/149900 colour Brown (size null)
        CHINO-BEG-30 qty1 149900/149900 size 30 colour Beige
payments CASH CONFIRMED 149900 ref null
         UPI  CONFIRMED 149900 ref UPI/QA-LOCALHOST-001
paymentSum 299800 === totalMinor  -> true
movements SALE -1 ; SALE -1  (referenceType SALE, referenceId = sale id)
```

**Payment sum exactly equals the sale total.** **No accidental single-CASH fallback** — two distinct `SalePayment` rows with distinct methods. UI money matches minor units exactly (`260873` -> `₹2,608.73`, `38927` -> `₹389.27`).

`paidMinor` equals `totalMinor` because `saleService` assigns it that way by design; the tendered figure is the sum of the payment rows. This is the F9 data-model limitation already recorded in `F10-IMPLEMENTATION-REPORT.md` §4.1 — unchanged here, not a new finding.

## 16. Responsive results (Phase 15)

CSS zoom was **not** used to simulate browser zoom. True 90% browser zoom remains a separate manual check.

| Screen | 1536 | 1280 | 900 | 390 |
|---|---|---|---|---|
| `/dashboard` | PASS | PASS | PASS | **FAIL** 559/390 (**D3**) |
| `/products` | PASS | PASS | PASS | PASS |
| `/products/[id]` | PASS | — | — | PASS |
| `/inventory` | PASS | PASS | PASS | PASS |
| `/pos` | PASS | PASS | PASS | PASS |
| `/pos` Sale Success | PASS | PASS | PASS | PASS |
| `/sales` | PASS | PASS | PASS | **FAIL** 400/390 (**D4**) |
| `/sales/[id]` | PASS | **FAIL** 1464/1280 (**D2**) | PASS | **FAIL** 814/390 (**D2**) |

## 17. Accessibility

Checked opportunistically, not as a full WCAG audit.

| Check | Result |
|---|---|
| Landmarks (`header`/`nav`/`main`/`aside`) | Present on the authenticated shell |
| Sale Success dialog | `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus moved in, 0 unlabeled controls |
| Login form | Inputs labelled; error message is text, not colour alone |
| Bill details tables | Real `<table>` with `<th>` headers |
| `Returns` tab | **Styled-disabled only** — keyboard-focusable, not announced as disabled (**D5**) |
| `/inventory/receipts/new`, `/inventory/adjustments/new` | **No `h1`** (**D7**) |

## 18. Console / Network (Phase 14)

Aggregated across every screen visited in all three browser passes:

| Category | Count | Detail |
|---|---|---|
| Page errors (uncaught) | **0** | — |
| Hydration errors | **0** | — |
| React warnings | **0** | — |
| Failed requests (network) | **0** | — |
| HTTP >= 400 | 4 distinct | see below |

```
404 /images/products/casual-crossbody-bag.jpg     <- pre-existing, see §22
404 /sales/cmzzzzzzzzzzzzzzzzzzzzzzzz             <- intentional, bogus-id probe
404 /sales/not-a-real-id                          <- intentional, bogus-id probe
404 /login                                        <- DEFECT D1
```

**This is not a clean result and is not reported as one.** One broken image is pre-existing; two 404s were deliberately provoked by the tenant-isolation probes and are the correct response; the `404 /login` is a genuine defect.

## 19. Auth / Logout (Phase 16) — PASS with one defect

Logout returned **200** and the `amburax_session` cookie was **removed** (`cookieAfter: []`).

| Route after logout | Landed | Protected content leaked? |
|---|---|---|
| `/dashboard` | `/auth/login` | No |
| `/pos` | `/auth/login` | No |
| `/sales` | `/auth/login` | No |
| `/sales/{id}` | **`/login` -> 404** | No |

Session genuinely revoked; nothing exposed. The redirect target on the last row is wrong — **D1**.

## 20. Test gates (Phase 17)

Run sequentially with the dev server stopped. **No test was modified.**

| Gate | Test Files | Tests | Failed | Skipped | Duration | Exit |
|---|---|---|---|---|---|---|
| `npm run test` | **41 passed (41)** | **581 passed (581)** | **0** | **0** | 15.76 s | **0** |
| `npm run test:integration` | **19 passed (19)** | **540 passed (540)** | **0** | **0** | **205.21 s** | **0** |
| `npm run typecheck` | n/a | n/a | **0 errors** | n/a | — | **0** |
| `npm run lint` | n/a | n/a | **0 errors**, 8 warnings | n/a | — | **0** |
| `npm run build` | 67/67 static pages | n/a | **0** | n/a | 15.2 s compile | **0** |

Two changes worth noting against the last recorded baseline (`F10-IMPLEMENTATION-REPORT.md` §13: 581 unit / 539 integration):

- Integration tests went **539 -> 540**: one test was added by the integration-infrastructure work committed in another session.
- Integration duration fell **1013 s -> 205 s**, a 5x improvement. That repair — replacing per-file `db.$disconnect()` with a single suite-wide `globalTeardown` — is now committed and demonstrably effective.

The 8 lint warnings are all `@next/next/no-img-element` or unused eslint-disable directives, in `inventory/movements/page.tsx`, `inventory/page.tsx`, `sales/_components/SalesWorkspace.tsx` and `components/inventory/InventoryDetailPanel.tsx`. All pre-existing; none is an error.

## 21. Defects found

No source was changed. Each defect is reported with evidence, per the instruction to stop and report before modifying anything.

### D1 — HIGH · `/sales/[id]` redirects to a non-existent route when logged out

**Evidence:** `apps/web/src/app/(app)/sales/[id]/page.tsx:41` and `:44` both call `redirect("/login")`. That route does not exist. Observed in Phase 16: requesting the bill page after logout lands on `/login` and returns **404**. Every other protected page in the codebase uses `/auth/login` (`dashboard/page.tsx:86`, `customers/page.tsx:53`, `inventory/adjustments/new/page.tsx:15`, and others).

**Impact:** A logged-out user following a bookmarked or shared bill link gets a 404 instead of the sign-in screen, and after signing in has no path back. **Not a security hole** — no protected content is exposed and the session check itself is correct; only the destination is wrong.

**Fix shape:** change two string literals to `/auth/login`. F12 territory.

### D2 — MEDIUM · `/sales/[id]` horizontal overflow at 1280 and 390

**Evidence:** 1280 viewport -> `scrollWidth 1464` (+184 px). 390 viewport -> `scrollWidth 814` (+424 px). The shallowest offending element is the page's own root container, `div.mx-auto.max-w-7xl.p-4.sm:p-6.lg:p-8`, measuring 1226 px inside a 1280 px viewport and extending to `right: 1464`.

**Diagnosis:** `max-w-7xl` is 1280 px, which equals the whole viewport — the container does not account for the ~238 px shell sidebar, so content plus sidebar exceeds the window by almost exactly the sidebar width. At 390 the sidebar is hidden, so the 814 px width comes from inner content (the items and payments tables) that has no `overflow-x` container.

**Impact:** The bill page scrolls sideways on a 1280 laptop and badly on a phone. Figures remain correct; it is a layout defect, not a data one.

### D3 — MEDIUM · `/dashboard` horizontal overflow at 390

**Evidence:** `scrollWidth 559` vs `clientWidth 390` (+169 px). Shallowest offender is the header action row `div.flex.items-center.gap-2` containing *POS (F2) · Add Item · Receive Stock · Generate Report*, extending to `right: 559`. `Receive Stock` ends at 451, `Generate Report` at 559 — the row does not wrap.

**Impact:** The dashboard, the post-login landing screen, scrolls sideways on every phone.

### D4 — LOW · `/sales` horizontal overflow at 390

**Evidence:** `scrollWidth 400` vs 390 (+10 px). Offender is the tab row *All Transactions · Sales · Voided · Returns* at `right: 400`. The data table itself is wider but correctly contained — page scrollWidth is only 400, so the table's own scroll container is working.

**Impact:** A 10 px sideways wobble on mobile. Cosmetic.

### D5 — LOW · `Returns` tab is styled-disabled but not actually disabled

**Evidence:** `apps/web/src/app/(app)/sales/_components/SalesWorkspace.tsx:163` —
`<button className="amb-tab opacity-50 cursor-not-allowed" title="Future Feature">Returns</button>`
No `disabled` attribute, no `aria-disabled`, no `onClick`.

**Impact:** Sighted mouse users get the right signal. Keyboard users can focus it and press it to no effect, and a screen reader announces an ordinary enabled button. The adjacent Returns *analytics* row is handled correctly (`opacity-40`, `0 · N/A`, empty bar) and fabricates nothing.

### D6 — MEDIUM · Product detail shows prices in dollars

**Evidence:** `apps/web/src/app/(app)/products/[id]/page.tsx:93` —
``{v.priceMinor != null ? `$${(v.priceMinor / 100).toFixed(2)}` : "-"}``

Rendered on screen as `$1349.00`, `$1299.00`. Every other surface uses the shared `formatMinor` helper and renders `₹1,349.00` with en-IN grouping. This is the only `$` in the products area.

**Impact:** A rupee-denominated store shows dollar prices on the variant table of every product detail page, with no thousands separator. Wrong currency on a price is a trust problem, not a cosmetic one.

### D7 — LOW · Two inventory sub-pages have no `h1`

**Evidence:** `/inventory/receipts/new` and `/inventory/adjustments/new` both return **200** and render their forms, but expose no `h1`. `/inventory/movements` returns an `h1` of `"Inventory"` rather than naming the movements view.

**Impact:** Screen-reader users get no page title for two data-entry forms. Minor accessibility gap.

## 22. Known / pre-existing issues (not new)

1. **`404 /images/products/casual-crossbody-bag.jpg`** — the demo catalogue references a product image absent from `public/`. Raised by catalogue tiles on `/pos` and `/products`; already recorded in `F10-IMPLEMENTATION-REPORT.md` §12. Seed-asset gap, not code.
2. **`/sales/export` dead link** — `sales/page.tsx:93` links to a route that does not exist. Recorded in `F10-SALE-SUCCESS-DESIGN-AUDIT.md` §4. Not re-tested here.
3. **`Sale.paidMinor` always equals `totalMinor`** — F9 data-model limitation, documented in `F10-IMPLEMENTATION-REPORT.md` §4.1. Unchanged.
4. **Negative stock balances** (`balanceAfter -4`, `-7` on this sale's variants) — **not a defect.** `apps/web/src/server/inventory/stockLedger.ts:114` states it explicitly: *"Refusing to oversell is a policy decision for the caller, not…"*. The ledger permits negative balances by design and no caller has imposed a no-oversell policy. Flagged only so it is not mistaken for corruption; whether POS *should* refuse to oversell is a product decision.
5. **8 lint warnings** — pre-existing `<img>` usage and unused eslint-disable directives.
6. **Middleware deprecation notice** — Next.js 16 asks for `proxy` instead of `middleware`. Informational.

## 23. Evidence

**45 screenshots** in the session scratchpad (`…/scratchpad/qa/`), covering login (clean and bad-credential), shell, dashboard, products, product detail, inventory, inventory movements/receipts/adjustments, POS, the three split-payment states, Sale Success, Sale Success under print media, sales history, sales search, and bill details — each at 1536 / 1280 / 900 / 390 where applicable.

**Structured results:** `qaA.json` (phases 1–5, 13), `qaB.json` (phases 4, 6–8), `qaC.json` (phases 9–11, 16), `overflow.json` plus `overflow-bill-1280.json` and `overflow-bill-390.json` (per-element overflow diagnostics).

**Test artifact:** the live network request body for the split sale, quoted verbatim in §10.

## 24. Git safety (Phase 18)

```
 M apps/web/next-env.d.ts          <- Next.js generated
 M apps/web/test-integration.out   <- test output artifact
 M apps/web/test.out               <- test output artifact
?? LOCALHOST-CHROME-QA-REPORT.md   <- this report
```

**No application source was modified by this QA pass.** No commits. No `git add .`. No history rewritten. No pre-existing untracked files cleaned. The integration-infrastructure changes observed mid-session in an earlier turn have since been committed by the other session and no longer appear as working-tree changes.

All QA scripts and screenshots live in the session scratchpad, outside the repository.

---

## FINAL STATUS

# LOCALHOST QA — DEFECTS FOUND

**Six defects: one HIGH, three MEDIUM, three LOW** (D1 high; D2, D3, D6 medium; D4, D5, D7 low).

**What works.** The core commercial path is sound end to end. A real split sale was rung up through the real UI, settled across two tenders with a reference, and every figure — bill number, total, subtotal, tax, item count, SKU, size, colour, payment methods, payment amounts, stock movement — agreed exactly across the POS success screen, the sales list, the bill page and the database, with zero mismatches. The `/sales` list shows `CASH + UPI`, not `CASH`. Bill details renders the requested sale and refuses foreign ids with a 404. ERP state is reported honestly everywhere, with no fabricated invoice number and no fake timeline event. No unsupported control appears in any DOM. Authentication, session handling, tenant scoping and logout all behave correctly. All five test gates exit 0, with no page errors, no hydration errors and no failed requests anywhere.

**Why not GREEN.** D1 sends a logged-out visitor to a 404 instead of the sign-in page. D6 prints dollar prices in a rupee store. D2 and D3 break layout on widths the product explicitly targets — the bill page on a 1280 laptop, and the dashboard on every phone. None of these corrupts data, and none blocks selling; all are visible to a user.

**Why not BLOCKED.** Nothing prevented the QA from completing. Every phase ran; every gate passed.

**Recommended order if these are fixed:** D1 (two string literals, highest ratio of harm to effort), then D6 (one template literal, use `formatMinor`), then D3 and D2 (layout), then D4, D5, D7.

**No source was changed, and F13 implementation was not started.**
