# F10 — Sale Success / Receipt Action: Implementation Report

**Screen:** Sale Success / Receipt Action (roadmap screen 18, `SCREEN_MAP.md:23`)
**Route:** `/pos` — no new route created
**Date:** 2026-10-03
**Baseline:** HEAD `e5cca5a` (branch `main`), with F9's work present and uncommitted in the working tree
**Reference:** `SCREENS/phase-2-screens/ChatGPT Image Oct 3, 2026, 11_26_53 AM.png`
**Audit:** `F10-SALE-SUCCESS-DESIGN-AUDIT.md`

---

## 1. Reference Mapping

Every element in the approved reference, and what shipped against it.

| Reference element | Shipped | Source of truth |
|---|---|---|
| Modal over a **dimmed but still-mounted** POS workspace | **Yes** | Previously the terminal was unmounted and replaced; it is now dimmed and stays on screen |
| Close `×` | **Yes** | Dismisses without starting a new sale; cart and idempotency key both survive |
| Green check success mark | **Yes** | `CheckCircle2` on `emerald-100` |
| Confetti around the mark | **No — deliberate** | Decorative only; nothing behind it. Noted in §3 |
| `Sale Completed!` | **Yes** | Static copy |
| `Bill generated successfully` | **Yes** | Static copy |
| Meta strip: **Bill No.** | **Yes** | `Sale.billNumber` |
| Meta strip: copy-bill-number icon | **Yes** | `navigator.clipboard`, with a `Check` confirmation and an `aria-live` announcement |
| Meta strip: **Date & Time** | **Yes** | `Sale.completedAt`, via the existing `formatDateTime` (en-IN, `Asia/Kolkata`) |
| Meta strip: **Total Amount** | **Yes** | `Sale.totalMinor` |
| Meta strip: **Items** | **Yes** | Sum of `SaleItem.quantity` — units sold, not line count |
| `Print Receipt` as solid blue primary | **Yes** | `window.print()`, scoped so only the receipt prints |
| `Download PDF` | **No — omitted** | No generator, no endpoint. §3 |
| `Share via WhatsApp` | **No — omitted** | No integration. §3 |
| `Email Receipt` | **No — omitted** | No dispatch. §3 |
| `View Bill Details` | **Yes** | Links to the existing `/sales/{id}` |
| `Return / Exchange` | **No — omitted** | Screens 22/23 unbuilt, no route. §3 |
| `New Sale` | **Yes** | Existing `startNewSale()` |
| Receipt: store name, code | **Yes** | `Store.name`, `Store.code` |
| Receipt: store address | **Yes** | `Store.addressLine`, `city`, `state`, `postalCode` |
| Receipt: **`GSTIN`** | **No — omitted** | No store-level tax registration exists. §3 |
| Receipt: **`Bill No.`** | **Yes** | `Sale.billNumber` |
| Receipt: **`Invoice No.`** | **No — omitted** | `Sale.erpInvoiceId` is always null; ERPNext not connected. §3 |
| Receipt: `Date & Time` | **Yes** | `Sale.completedAt` |
| Receipt: `Cashier` | **Yes** | `Sale.cashier.name` |
| Receipt: **`Sales Person`** | **No — omitted** | No field, no model. §3 |
| Receipt: `Customer` | **Yes, conditional** | `Sale.customer` — name and phone; row absent on a walk-in |
| Receipt: item table `# / Item / Qty / Price / Total` | **Yes** | `SaleItem` snapshots. Rendered as a real `<table>` with `<th scope="col">` |
| Receipt: `SKU \| size / colour` sub-line | **Yes** | `skuSnapshot` + live `ProductVariant.size` / `.colour`. Limitation documented in code |
| Receipt: `Subtotal` | **Yes** | `Sale.subtotalMinor` |
| Receipt: `Item Discount` | **Conditional, relabelled `Discount`** | `Sale.discountMinor`, rendered only when `> 0`. §4 |
| Receipt: `GST (5%)` | **Shipped as `Tax`** | `Sale.taxMinor`. The rate is per-line (`SaleItem.taxRateBp`), not one sale-wide rate, so a single "GST (5%)" label would be false on a mixed-rate basket |
| Receipt: `Total (N items)` | **Yes** | `Sale.totalMinor` + summed quantities |
| Receipt: `Payment Details`, numbered rows | **Yes** | Every `SalePayment`: method, reference, amount |
| Receipt: barcode | **No — omitted** | No library, and nothing in the product can consume a scanned bill. §3 |
| Change due | **Yes, conditional** | Derived from tenders. §4 — the one place the spec and the data disagreed |
| ERP sync state | **Yes — "ERP sync pending"** | Required by `schema.prisma:1092-1094`; not in the reference |

---

## 2. Implemented Elements

**Files changed — two:**

| File | Change |
|---|---|
| `apps/web/src/server/sales/saleQueries.ts` | **Additive read-side only.** `SaleDetail` gains `storeAddressLine`, `storeCity`, `storeState`, `storePostalCode`, and `items[].size` / `items[].colour`. The `select` gains the matching `Store` and `ProductVariant` fields. No field removed, none retyped — all nine existing consumers compile and behave unchanged. |
| `apps/web/src/app/(app)/pos/PosTerminal.tsx` | New `SaleReceipt` type; `receipt` / `receiptFailed` / `copied` state; `loadReceipt()`, `dismissSuccess()`, `printReceipt()`, `copyBillNumber()`; the render switched from unmount-and-replace to dim-and-mount; `SaleSuccess` rebuilt as the two-column dialog. |

**Not changed, as required:** `createSale`, `SaleSummary`, `POST /api/v1/sales`, `schema.prisma`, `PrintButton.tsx`, `/sales`, `/sales/[id]`, `sales.test.ts`, and every F9 payment path. **No migration. No new route. No new endpoint.**

**Data contract.** The success screen re-reads the sale through the **existing** `GET /api/v1/sales/[id]`, which was already in the tree and already backed by `getSaleDetail`. That endpoint resolves the session server-side and returns the same 404 for another tenant's sale as for one that never existed, so tenant isolation is the server's and was not re-implemented.

**Accessibility.** `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the heading; focus moves into the dialog on open and onto `Print Receipt` once it is enabled; Tab is trapped and wraps; `Escape` dismisses; the copy action announces through `aria-live`; the receipt is a real table with column headers.

---

## 3. Deliberately Omitted

Omitted means **absent from the DOM** — not hidden, not disabled, not labelled "coming soon". Each omission is a verified absence (§5).

| Omitted | Evidence it cannot be real today |
|---|---|
| **`Invoice No.`** | `Sale.erpInvoiceId` is nullable and always null; ERPNext is not connected (`schema.prisma:1092-1094`). Invoice numbering is ERPNext-authoritative (ADR-063 / ADR-079) and `billNumber` is explicitly not an invoice number. Printing a fabricated one on a customer receipt is a tax-document risk, not a cosmetic gap. |
| **Seller `GSTIN`** | `Store` carries no tax-registration field. `Tenant.taxId` is nullable, tenant-wide and unvalidated; `Customer.gstin` is the buyer's. Per instruction, `Tenant.taxId` was **not** mapped into a field labelled GSTIN. |
| **`Sales Person`** | No sales-attribution field on `Sale`, no commission model. |
| **`Download PDF`** | No PDF generator, no export endpoint, no dependency. |
| **`Share via WhatsApp`** | No WhatsApp integration; no `navigator.share` anywhere in `apps/web/src`. |
| **`Email Receipt`** | No transactional receipt e-mail. |
| **`Return / Exchange`** | Screens 22/23 unbuilt — no route, no service, no eligibility rules. |
| **Barcode** | No library in `apps/web/package.json`, and no scanner path can consume a bill barcode until returns exist. |
| **Confetti** | Decorative. Omitted to keep the first pass to things that carry meaning; trivial to add later if wanted. |

This follows the ruling already recorded in the codebase, in `apps/web/src/app/(app)/sales/[id]/PrintButton.tsx`: *"e-mail, PDF export and WhatsApp share all appear in the design reference and none of them exist, so shipping those buttons would mean shipping three controls that silently do nothing."*

---

## 4. Two Places Where the Reference or the Spec Met Reality

### 4.1 Change due — the instruction's expression can never fire

The brief said: render change when `paidMinor - totalMinor > 0`.

`saleService` assigns `const paidMinor = totals.totalMinor;` unconditionally (`saleService.ts:299`). So `Sale.paidMinor` **always equals** `Sale.totalMinor`, and that expression is always exactly zero — a change-due feature built on it could never display, on any sale.

The overpayment is real and it is recorded; F9 puts it on the `SalePayment` rows. Proven on sale `MAIN-000081`:

```
totalMinor      299800     (₹2,998.00)
paidMinor       299800     <- equals total, as F9 writes it
tenderedMinor   309800     <- sum of SalePayment.amountMinor
derivedChange    10000     (₹100.00)
```

Change is therefore derived as `sum(payments.amountMinor) - totalMinor`, with the "only when positive" guard kept. **No F9 semantics were altered** — this is a read-side derivation from the column that actually holds the number. Documented at the call site.

**Known limit, F9's to decide and not this screen's:** a single-tender cash sale does not send an amount, so the server records the tender as the total and no change can be derived. Change therefore appears on split tenders, where the amount handed over is explicitly recorded. The "Amount Received" box on a single-tender cash sale remains a UI aid that is never persisted.

### 4.2 Discount

Rendered conditionally from `Sale.discountMinor` and labelled **`Discount`**, not `Item Discount` — per-line POS discounting does not exist (`/pos` sends no discount at all; `discountMinor` defaults to `0` at `route.ts:122`), so naming a mechanism that is not there would be false. The reference's `₹150` is nowhere in the source. On every sale the current POS can create, the row is correctly absent.

---

## 5. Browser Evidence — Previously Verified

Real sales, real catalogue, real session (`owner@demo.amburax.test`), starting from `/pos` each time. These runs were taken during implementation; §5A records the single consolidated run taken after the last line of code changed.

| # | Bill | Sale id | Scenario | Result |
|---|---|---|---|---|
| 1 | `MAIN-000081` | `cmus0hces003ywlyav8c74brx` | SPLIT, cash overpay | Total ₹2,998.00 · Items 2 · **Change due ₹100.00** · `1. CASH ₹3,098.00` |
| 2 | `MAIN-000082` | `cmus0hjas004bwlyak13bqvd0` | SPLIT, exact, two tenders + reference | Total ₹3,848.00 · no change row · `1. CASH ₹1,924.00` / `2. UPI  UPI/F10TEST001  ₹1,924.00` |
| 3 | `MAIN-000083` | `cmus0hnhz004pwlya26iqe60g` | UPI | `1. UPI ₹1,349.00` |
| 4 | `MAIN-000084` | `cmus0hrnt004zwlyahlqyyxrd` | CARD | `1. CARD ₹1,349.00` |
| 5 | `MAIN-000085` | `cmus0hvoq0059wlyazd7f0cnu` | More | `1. CASH ₹1,349.00` (unchanged CASH fallback) |
| 6 | `MAIN-000086` | `cmus0kzpl005nwlyaoxznrtb8` | Focus + tab trap | Change due ₹50.00 |
| 7 | `MAIN-000088` | `cmus0ngtd006fwlyapyqfz8n2` | Bill Details navigation | Resolves to `/sales/{id}` |
| 8 | `MAIN-000090` | — | Final responsive pass | Verified at all four widths |

**Idempotency.** Dismissed the modal with `Escape`, then pressed Complete Sale again on the surviving cart:

```
cartSurvivedDismiss: true
resubmit.bill:        MAIN-000085   <- same bill, no second sale
duplicateNoticeShown: true
```

**Receipt line rendering**, read off the live DOM:

```
Casual Crossbody Bag   CCB-001 | Brown           2   ₹1,499.00   ₹2,998.00
Chinos                 CHINO-BEG-30 | 30 / Beige  1   ₹1,499.00   ₹1,499.00
```

Size and colour are the real variant values; the `| Brown` line shows the join handling a null size correctly.

**Absence gates** (regex over the rendered modal, sale #1): `invoiceNo false`, `gstin false`, `salesPerson false`, `pdf false`, `whatsapp false`, `email false`, `returnExchange false`, and `referenceSampleValues false` — none of `POS-20241324`, `SINV-24-008521`, `29ABCDE1234F1Z5`, `ATELIER RETAIL`, `Ravi Kumar`, `Amit Sharma`, `Ali Khan` appears anywhere.

**Screenshots** (session scratchpad, `…/scratchpad/f10/`): `f10-success-1536.png`, `f10-success-1280.png`, `f10-success-900.png`, `f10-success-390.png`, `f10-change-due-1536.png`, `f10-print-only-receipt.png`, `f10-bill-details-1536.png`, `f10-sales-1536.png`, `f10-inventory-1536.png`, `f10-final-1536.png`.

---

## 5A. Final Evidence — Consolidated Run After the Last Code Change

Everything above was gathered while building. This section is the single end-to-end pass taken **after the final edit** (the 390 clipping fix), against the final code, and is the evidence F10's status rests on. One sale was created — the minimum the gate requires, deliberately mirroring `MAIN-000081`'s cart so the two are directly comparable.

**Sale `MAIN-000091` — `cmus25cky0006sted0rp3emz3`**, SPLIT with cash overpayment, cart total ₹2,998.00.

| Checked | Observed | Verdict |
|---|---|---|
| Sale Success state appears | `Sale Completed!` | PASS |
| Bill number | `MAIN-000091` | PASS |
| Total | `₹2,998.00` (header) / `₹2,998.00` (receipt) | PASS |
| Item count | `2` | PASS |
| Payment rows | `1. CASH  ₹3,098.00` | PASS |
| SKU | `CHINO-BEG-32`, `CHINO-GRY-32` | PASS |
| Size / colour | `32 / Beige`, `32 / Grey` | PASS |
| Conditional discount | `discountMinor = 0` → row **absent** | PASS |
| Change due | `Change due ₹100.00` (header) / `₹100.00` (receipt) | PASS |
| Honest ERP state | `ERP sync pending` | PASS |
| Print Receipt action | `window.print()` invoked — `printCalls: 1` | PASS |
| View Bill Details | → `/sales/cmus25cky0006sted0rp3emz3`, shows `MAIN-000091`, bill page's own `Print bill` intact | PASS |
| New Sale | present and reachable at every width | PASS |
| Close control | present and reachable at every width | PASS |
| Copy bill number | present | PASS |

**Unsupported controls — verified absent from the DOM, not hidden:**

```
invoiceNo false · gstin false · salesPerson false · pdf false · whatsapp false
email false · returnExchange false · barcodeNode false · referenceSampleValues false
```

`referenceSampleValues false` means none of `POS-20241324`, `SINV-24-008521`, `29ABCDE1234F1Z5`, `ATELIER RETAIL`, `Ravi Kumar`, `Amit Sharma`, `Ali Khan` appears anywhere in the rendered screen.

**Final database correlation — `MAIN-000091`:**

```
total 299800 · paid 299800 · tendered 309800 · change 10000
units 2 · discount 0 · erp PENDING · erpInvoiceId null · customer null · posSessionId null
items     CHINO-BEG-32 32/Beige x1 ; CHINO-GRY-32 32/Grey x1
payments  CASH CONFIRMED 309800
movements SALE -1 bal 27 ; SALE -1 bal 8   (referenceId = cmus25cky0006sted0rp3emz3)
```

Identical shape to `MAIN-000081`, including `paidMinor == totalMinor` with the overpayment held on the tender row.

**Final responsive measurements** — heading and close control both at `top >= 0` (unclipped) at every width, no horizontal overflow anywhere:

| Width | `scrollWidth` / `clientWidth` | Horizontal overflow | Heading unclipped | Close unclipped | Close `top` | Print | New Sale | Receipt |
|---|---|---|---|---|---|---|---|---|
| 1536 × 1024 | 1536 / 1536 | **false** | **true** | **true** | 212px | 384×48 | 384×50 | 448×623 |
| 1280 × 1024 | 1280 / 1280 | **false** | **true** | **true** | 212px | 384×48 | 384×50 | 448×623 |
| 900 × 1024 | 900 / 900 | **false** | **true** | **true** | 28px | 804×48 | 804×50 | 868×624 |
| 390 × 844 | 390 / 390 | **false** | **true** | **true** | 28px | 310×48 | 310×50 | 358×608 |

At 900 and 390 the columns stack (receipt moves below the actions, `top` 596px and 630px) and the close control sits at `top: 28px` — reachable without scrolling, which is precisely the defect fixed in §10. No unintended desktop page scroll: the modal is `fixed`, and the POS workspace keeps its own `h-[calc(100vh-68px)]` containment.

**Final print-media check** (computed styles):

```
workspace      none     actionsColumn  none
close          none     receipt        block
```

**Final console / network:** 0 page errors, 0 failed requests, 0 hydration warnings. Two `404 /images/products/casual-crossbody-bag.jpg` — the pre-existing seed-asset gap described in §12, raised by the catalogue tile, not by F10.

---

## 6. Database Correlation

Read-only Prisma queries against the exact browser-created sale `cmus0hces003ywlyav8c74brx`.

| Field | Database | On screen | Match |
|---|---|---|---|
| `billNumber` | `MAIN-000081` | `MAIN-000081` | yes |
| `status` | `COMPLETED` | — | yes |
| `subtotalMinor` | `267678` | `₹2,676.78` | yes |
| `discountMinor` | `0` | row absent | yes |
| `taxMinor` | `32122` | `₹321.22` | yes |
| `totalMinor` | `299800` | `₹2,998.00` | yes |
| `paidMinor` | `299800` | not displayed (see §4.1) | yes |
| tendered (sum of `SalePayment.amountMinor`) | `309800` | `₹3,098.00` | yes |
| derived change | `10000` | `₹100.00` | yes |
| `erpSyncStatus` | `PENDING` | `ERP sync pending` | yes |
| `erpInvoiceId` | `null` | not rendered | yes |
| units sold | `2` | `Items 2` | yes |
| `tenantId` | `69d8eea5-…d345ff` (`Demo Retail Co.`) | — | scoped |
| `storeId` / store | `Main Store` / `MAIN` / `123 MG Road` / `Bengaluru` / `Karnataka` / `560001` | identical in receipt header | yes |
| `cashier` | `Demo Owner` | `Demo Owner` | yes |
| `customer` | `null` (walk-in) | row absent | yes |
| `posSessionId` | `null` | not rendered | yes — honest, no till session was open |
| `SaleItem[0]` | `Chinos` / `CHINO-BEG-32` / qty 1 / `149900` / size `32` / colour `Beige` | `Chinos · CHINO-BEG-32 \| 32 / Beige · 1 · ₹1,499.00` | yes |
| `SaleItem[1]` | `Chinos` / `CHINO-GRY-32` / qty 1 / `149900` / size `32` / colour `Grey` | `Chinos · CHINO-GRY-32 \| 32 / Grey · 1 · ₹1,499.00` | yes |
| `SalePayment[0]` | `CASH` / `CONFIRMED` / `309800` / ref `null` | `1. CASH  ₹3,098.00`, no status badge (confirmed) | yes |

**Terminal / till context:** `Sale.posSessionId` is `null` because no shift was open on the demo till. The screen renders no terminal line, which is the truthful outcome rather than a fabricated one.

---

## 7. Print Verification

Verified under emulated `print` media, computed styles:

```
workspaceDisplay:      none     <- the whole POS terminal is suppressed
actionsColumnDisplay:  none     <- Print / Bill Details / New Sale suppressed
closeDisplay:          none     <- the close control is suppressed
receiptDisplay:        block    <- only the receipt remains
```

Implemented with Tailwind `print:` variants on the existing `window.print()` capability — the same mechanism `PrintButton.tsx` already uses. **No global `@media print` rule was added**, so `/sales/[id]`'s own print behaviour is untouched. No thermal-printer stylesheet was invented.

---

## 8. `/sales` Correlation

`/sales` renders and contains the bill number of the sale just completed (`containsBill: true`). Screenshot `f10-sales-1536.png`.

`View Bill Details` navigates to `/sales/{id}`:

```
url after click:            http://localhost:3000/sales/cmus0ngtd006fwlyapyqfz8n2
billPage.showsBillNumber:   true
billPage.billNumber:        MAIN-000088
billPage.hasPrintBill:      true
```

The bill page and its existing `Print bill` button are unmodified. The success modal's receipt is a preview; `/sales/{id}` remains the system of record.

*(An earlier run reported this as failing — that was a test-harness fault: the URL was read before Next's client navigation committed. Re-verified with an adequate wait; navigation works.)*

---

## 9. `/inventory` Correlation

Stock moved inside the sale transaction. `StockMovement` rows for sale `cmus0hces003ywlyav8c74brx`:

```
variantId cmu9xxxcs001p2ar3a3pvl8oh  type SALE  quantityDelta -1  balanceAfter 28
          idempotencyKey SALE:cmus0hces003ywlyav8c74brx:cmu9xxxcs001p2ar3a3pvl8oh
variantId cmu9xxxce001l2ar3jvfeyvrf  type SALE  quantityDelta -1  balanceAfter  9
          idempotencyKey SALE:cmus0hces003ywlyav8c74brx:cmu9xxxce001l2ar3jvfeyvrf
```

`referenceType SALE`, `referenceId` equal to the sale id, one movement per line, delta matching quantity sold. `StockLevel` reads 9 and 28, matching `balanceAfter`. `/inventory` renders. The success screen makes **no** claim about stock — correct, since `StockLevel` is an operational projection, not a ledger (`schema.prisma:1182-1189`).

---

## 10. Responsive Results

| Width | `scrollWidth` / `clientWidth` | Dialog | Print | New Sale | Close | Receipt | Verdict |
|---|---|---|---|---|---|---|---|
| 1536 × 1024 | 1536 / 1536 | yes | yes | yes | yes | yes | **PASS** |
| 1280 × 1024 | 1280 / 1280 | yes | yes | yes | yes | yes | **PASS** |
| 900 × 1024 | 900 / 900 | yes | yes | yes | yes | yes | **PASS** |
| 390 × 844 | 390 / 390 | yes | yes | yes | yes | yes | **PASS** |

No horizontal overflow at any width. Columns stack below `lg`; the receipt stays legible; all actions reachable.

**One defect found and fixed during this work.** At 390 the dialog is taller than the viewport, and a centred flex child inside a scrolling parent has its overflow **clipped at the top** — the success mark, the heading and the close control were unreachable above the fold. Replaced the single `fixed inset-0 flex items-center overflow-y-auto` with the correct two-element pattern: scrolling on the outer box, centring on an inner `flex min-h-full items-center`. Re-verified: the full dialog is reachable at 390. The reasoning is recorded in a comment so it is not "simplified" back.

**F8 preserved.** The POS workstation structure is untouched: no change to the `h-[calc(100vh-68px)]` workspace, its `lg:overflow-hidden`, the checkout column, or the payment geometry. The modal is `fixed`, so it introduces no desktop page scroll. The one class added to the workspace root is `print:hidden`, which is inert on screen.

---

## 11. Accessibility

| Check | Result |
|---|---|
| Dialog semantics | `role="dialog"`, `aria-modal="true"`, `aria-labelledby="sale-success-heading"` — all present |
| Accessible name | `Sale Completed!` |
| Focus on open | Lands on `success-print` (verified: `activeElement` = `success-print`) |
| Focus trap | Tab cycles `print → bill-details → new-sale → close → print`; `insideDialog: true` on all six probes |
| Escape | Dismisses; cart and idempotency key survive |
| Unlabeled interactive elements | **0** |
| Icon-only controls | close has `aria-label="Close and return to the till"`; copy has `aria-label="Copy bill number …"` |
| Visible focus | `focus-visible:outline-2` on every action |
| Receipt table | Real `<table>` with `<th scope="col">` (`ITEM / QTY / PRICE / TOTAL`) and an `sr-only` caption |
| Copy feedback | Announced via `aria-live="polite"`, not colour or icon alone |
| Heading order | `h2` under the page's existing `h1`, no level skipped |

---

## 12. Console / Network

| Check | Result |
|---|---|
| Page errors | **0** across every run |
| Failed requests | **0** |
| Hydration warnings | **0** |
| New `any` | **0** — `git diff` over both changed files shows no added `any` |
| Credential leakage | None — no token, session value or secret rendered or logged |
| HTTP 400+ | Two per catalogue render: `404 /images/products/casual-crossbody-bag.jpg` |

The 404 is a **pre-existing seed-asset gap**: the demo catalogue references a product image that is not in `public/`. It is raised by the catalogue tile, not by F10 — the receipt renders no images. Out of scope; recorded so it is not mistaken for a regression.

---

## 13. Test Gates

Run with the dev server stopped.

All five gates were re-run **against the final code**, after the last edit.

| Gate | Test Files | Tests | Failed | Skipped | Duration | Exit |
|---|---|---|---|---|---|---|
| `npm run test` | **41 passed (41)** | **581 passed (581)** | **0** | **0** | 16.24s | **0** |
| `npm run test:integration` | **19 passed (19)** | **539 passed (539)** | **0** | **0** | 973.28s | **0** |
| `npm run typecheck` | n/a | n/a | **0 errors** | n/a | — | **0** |
| `npm run lint` | n/a | n/a | **0 errors**, 7 warnings | n/a | — | **0** |
| `npm run build` | 67/67 static pages | n/a | **0** | n/a | 12.9s compile | **0** |

The integration figure above is the **final** run (start 12:27:26, 973.28s), executed after the 390 clipping fix. An earlier run during implementation reported the same 19 files / 539 tests / 0 failed / 0 skipped / exit 0 in 1013.72s.

Test counts are **identical to F9's closing baseline** (581 unit / 539 integration per `F9-IMPLEMENTATION-REPORT.md:108-109`) — F10 added no tests and broke none. That F10 ships no new automated tests is stated plainly rather than implied: its verification is the real-browser and database correlation evidence in §5A and §6.

The 7 lint warnings are all pre-existing `@next/next/no-img-element` in `inventory/page.tsx`, `products/page.tsx` and `InventoryDetailPanel.tsx`. **None is in a changed file.**

No generated `.next` file was edited to satisfy typecheck.

---

## 14. F9 Regression

Every payment path re-run through the real UI after the F10 changes:

| Method | Bill | Recorded payment | Verdict |
|---|---|---|---|
| CASH (single tender) | `MAIN-000071` | `1. CASH ₹4,497.00` | **PASS** |
| UPI | `MAIN-000083` | `1. UPI ₹1,349.00` | **PASS** |
| CARD | `MAIN-000084` | `1. CARD ₹1,349.00` | **PASS** |
| SPLIT (exact, 2 tenders, reference) | `MAIN-000082` | `1. CASH ₹1,924.00` / `2. UPI UPI/F10TEST001 ₹1,924.00` | **PASS** |
| SPLIT (cash overpay) | `MAIN-000081` | `1. CASH ₹3,098.00`, change ₹100.00 | **PASS** |
| More | `MAIN-000085` | `1. CASH ₹1,349.00` — CASH fallback unchanged | **PASS** |

Split validation rules unchanged (sum below total still blocks; overpayment still requires a CASH row). `startNewSale()` still clears every field and rotates the idempotency key. No change to the payment contract, the split semantics, or `sales.test.ts`.

---

## 15. Git State

```
 M apps/web/next-env.d.ts                            <- Next.js generated, not hand-edited
 M apps/web/src/app/(app)/pos/PosTerminal.tsx        <- F10 (and F9's uncommitted work)
 M apps/web/src/server/sales/saleQueries.ts          <- F10, additive read-side only
 M apps/web/src/test-integration/sales.test.ts       <- F9's uncommitted work, NOT touched by F10
?? F10-SALE-SUCCESS-DESIGN-AUDIT.md                  <- F10 audit
?? F10-IMPLEMENTATION-REPORT.md                      <- this report
```

**A caveat stated plainly:** `PosTerminal.tsx` was **already modified in the working tree** when F10 began — F9 closed green but was never committed. The `git diff` against HEAD for that file therefore mixes F9's uncommitted work with F10's, and the raw line count cannot be attributed to F10 alone. F10's own additions to it are: the `SaleReceipt` type, three pieces of state, four functions, the render switch from unmount to dim, and the `SaleSuccess` rewrite. Nothing F9 wrote was removed or rewritten. `saleQueries.ts` is cleanly F10's: a 41-line additive change.

**No commits made. No F9 history rewritten. No pre-existing untracked files cleaned. `SCREENS/` was read only** — the reference image was opened and nothing in that directory was created, modified or deleted.

All test scripts and screenshots live in the session scratchpad, outside the repository.

---

## 16. Remaining Manual / Compliance Items

1. **Seller GSTIN — a tax decision, not a screen decision.** The receipt shows a `Tax` line with no seller registration number, because none exists in the data model. Whether an Indian retail receipt may ship this way, and whether a per-store GSTIN field is needed, is a compliance call for the owner. `Tenant.taxId` was deliberately **not** pressed into service.
2. **Change due on single-tender cash.** F9 does not persist the amount received for a single tender, so change cannot be derived there. If cashiers need change shown on plain cash sales, F9 must record the tendered amount — an F9 decision, not an F10 one.
3. **`sizeSnapshot` / `colourSnapshot`.** Size and colour are joined live from `ProductVariant`. Editing a variant would retroactively change what a past receipt says was sold — the precise failure `SaleItem`'s snapshot design exists to prevent. Low risk (these fields define the variant) but worth its own slice. Documented at the join.
4. **The six omitted controls.** PDF, WhatsApp, Email, Return/Exchange, barcode and Sales Person each need a backend before they can appear. Sequencing is the owner's.
5. **Confetti.** Cosmetic gap against the reference, deliberately deferred.
6. **Pre-existing 404.** `/images/products/casual-crossbody-bag.jpg` is missing from `public/`. Seed-data gap, unrelated to F10.
7. **Pre-existing dead link.** `apps/web/src/app/(app)/sales/page.tsx:93` links to `/sales/export`, which does not exist. Shipped F7 defect, left untouched.
8. **Three design-hook findings** in pre-existing F8/F9 code (`PosTerminal.tsx` lines ~536, ~801, ~858): `text-slate-400` on `bg-slate-50` in a catalogue tile placeholder, a cart delete icon and a disabled `ActionBtn`. Read as false positives (muted/disabled treatment on near-white, not gray-on-saturated). Left standing and **not suppressed** — fixing or ignoring them means editing F8/F9 surfaces this slice was told not to touch.

---

## 17. Status

**F10 — Sale Success / Receipt Action: CLOSED / GREEN.**

Every gate exits 0 with test counts matching F9's baseline. The screen was driven through real sales against the real catalogue and database; every displayed figure was correlated field-by-field to the `Sale`, `SaleItem`, `SalePayment` and `Store` rows that produced it. Every unsupported element in the reference was omitted rather than faked, and each omission was verified absent from the DOM. F9's payment paths all still work and its contract, schema and tests are untouched.

Two things deserve the owner's eye before this is finished product rather than finished code: the GSTIN compliance question (§16.1) and the single-tender change-due limitation (§16.2). Neither blocks the screen; both are F9 or compliance decisions rather than F10 defects.

**Stopping here. F11 not started.**
