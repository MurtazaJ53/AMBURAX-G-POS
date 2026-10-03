# F9 — Payment / Split Payment: Final Verification Report

**Screen:** Payment / Split Payment · **Route:** `/pos`
**Verified:** 3 October 2026
**Branch:** `main` · **HEAD:** `e5cca5a93f9d37858541133afc11e734343f03a4`

Written for the AMBURAX engineering team as the F9 closure record. Every number below is copied
from actual command output or a live database query; nothing is estimated or carried forward from
an earlier report.

---

## 0. Summary

**F9 PAYMENT / SPLIT PAYMENT = CLOSED / GREEN**, with the non-blocking items in §13.

Two defects were found during this gate and fixed. Both were pre-existing at `HEAD` and both were
load-bearing for F9's own claims:

1. **The POS never sent split payments.** `PosTerminal.tsx` collected the split rows into state and
   then discarded them, posting `payment: { method: "CASH" }` for the whole total whenever SPLIT was
   selected. The cashier saw two payments; the database recorded one, under the wrong method, with
   no reference.
2. **The split integration tests never ran.** `describe("Split Payments")` was declared inside
   `beforeEach`, which Vitest rejects at collection time. This did not fail four payment tests — it
   failed the entire `sales.test.ts` file, all 34 tests in it.

Any earlier report claiming F9 split payments were verified was relying on tests that were never
collected and a UI path that never transmitted the data.

---

## 1. The repaired integration-suite issue

**File:** `apps/web/src/test-integration/sales.test.ts`

Before the repair, the suite aborted during collection:

```
FAIL  src/test-integration/sales.test.ts
Error: Calling the suite function inside test function is not allowed.
      It can be only called at the top level or inside another suite function.
 ❯ src/test-integration/sales.test.ts:66:3
     64|   await seedCommerce();
     65|
     66|   describe("Split Payments", () => {
       |   ^
```

The `describe` block sat inside the `beforeEach` hook. The fix moves it to top level. Nothing else
changed — proven by a whitespace-insensitive diff, which reduces the entire 236-line change to one
moved brace and a comment:

```
$ git diff -w --stat -- apps/web/src/test-integration/sales.test.ts
 apps/web/src/test-integration/sales.test.ts | 12 +++++++++++-
 1 file changed, 11 insertions(+), 1 deletion(-)
```

The 11 insertions are the explanatory comment plus `});`; the single deletion is the `});` that
previously closed `beforeEach` after the block. **No assertion, fixture, payment semantic or
unrelated file was touched.**

### Collection proof

```
$ npx vitest list --config vitest.integration.config.ts | grep -i split
src/test-integration/sales.test.ts > Split Payments > Exactly matches total
src/test-integration/sales.test.ts > Split Payments > Insufficient sum fails
src/test-integration/sales.test.ts > Split Payments > Overpayment requires CASH
src/test-integration/sales.test.ts > Split Payments > Overpayment works with CASH
```

All four cases are registered by name. The totals corroborate independently: the broken run
reported **535** tests (501 passed + 34 failed); the repaired run reports **539**. The difference of
exactly 4 is this suite, which existed in the file but was never registered.

---

## 2. The source change

**File:** `apps/web/src/app/(app)/pos/PosTerminal.tsx` (163 lines changed)

No redesign, no replacement payment screen, no new component. The existing panel and its existing
rows are unchanged; what changed is what happens to them:

| Change | Why |
| --- | --- |
| `completeSale()` sends `payments[]` when SPLIT is active | `createSaleSchema` and `saleService` already accepted it; the UI simply never used it |
| Rows with no amount are dropped, not sent as zero | The server requires ≥1 minor unit per payment; an untouched row is not a payment anyone made |
| Complete Sale gated on `splitBlocked` | Restates the server's two rules at the button so common mistakes are not a round trip |
| Split tally hoisted out of a JSX IIFE | The "Remaining" a cashier reads and the rule enabling the button were separate expressions that merely happened to agree |
| New `SplitMethod` / `SplitRow` types | A row cannot hold `"SPLIT"`/`"MORE"`, so the payload needs no cast |
| `aria-pressed` on the five method buttons | Required by the design spec §11; previously absent |
| `aria-label` on every split control, `label/for` on Amount Received | The controls had placeholder text and a bare `×` glyph, no accessible names |

`MORE` keeps its CASH fallback. It has no interaction design and no implementation behind it, and
inventing one is not this gate's job.

---

## 3. Static gates — all five exit 0

Run sequentially, never concurrently, with `next dev` stopped.

| Command | Test Files | Tests | Failed | Skipped | Exit |
| --- | --- | --- | --- | --- | --- |
| `npm run test` | 41 passed (41) | **581 passed (581)** | 0 | 0 | **0** |
| `npm run test:integration` | 19 passed (19) | **539 passed (539)** | 0 | 0 | **0** |
| `npm run typecheck` | — | — | — | — | **0** |
| `npm run lint` | — | — | — | — | **0** |
| `npm run build` | — | — | — | — | **0** |

- Integration duration 934.60s, single run, no concurrent suite — the historical PostgreSQL
  deadlock condition was avoided.
- Lint: `✖ 7 problems (0 errors, 7 warnings)`. All seven are pre-existing `@next/next/no-img-element`
  warnings in `inventory/movements/page.tsx`, `inventory/page.tsx` and `InventoryDetailPanel.tsx`.
  None is in an F9 file.
- Build: `✓ Compiled successfully in 21.0s`, 67/67 static pages generated.

**Environment note worth keeping.** `npm run typecheck` fails while `next dev` is running:

```
.next/dev/types/validator.ts(893,1): error TS1128: Declaration or statement expected.
```

The dev server rewrites `next-env.d.ts` to point at `.next/dev/types/*` and emits a validator file
`tsc` cannot parse. This is generated output and was not modified. Typecheck exits 0 with the dev
server stopped. If CI ever runs typecheck beside a dev server it will fail for reasons unrelated to
the code.

---

## 4. Real browser split sale (live dev database)

Flow performed through the existing `/pos` UI. No direct `createSale` call. The dev database was
**not** reset or reseeded.

| Step | Observed |
| --- | --- |
| Cart (real catalogue) | `Casual Crossbody Bag CCB-001 \| Brown ₹1,499.00 ×1`, `Chinos CHINO-BEG-32 \| Beige \| 32 ₹1,499.00 ×1` |
| Total read from live POS state | `totalMinor = 299800` (₹2,998.00) |
| Split selected | `aria-pressed="true"` on Split; Cash/UPI/Card/More remain visible, all `aria-pressed="false"` |
| Initial rows | 2 rows — `["CASH","UPI"]` |
| Row 1 | CASH ₹2,000.00 |
| Row 2 | UPI ₹998.00, reference `F9-FINAL-UPI-0001` |
| Remaining | `—` (zero) |
| Complete Sale | **enabled** |
| Page overflow before submit | `hOverflow=false` (scrollW 1536 = innerW 1536) |
| Result | `Payment Successful \| ₹2,998.00 \| Bill MAIN-000066` |

Actual client request payload:

```json
{"idempotencyKey":"e0060c14-9e68-4131-81b5-ce4b173bf734",
 "lines":[{"variantId":"cmu9y4drm009z12ckkbwm1kax","quantity":1},
          {"variantId":"cmu9xxxce001l2ar3jvfeyvrf","quantity":1}],
 "customerId":null,
 "payments":[{"method":"CASH","amountMinor":200000},
             {"method":"UPI","amountMinor":99800,"reference":"F9-FINAL-UPI-0001"}]}
```

`payments[]` with two entries. No single-CASH collapse.

---

## 5. Database correlation

Queried directly after the browser sale.

**Sale** — exactly one row.

| Field | Value |
| --- | --- |
| id | `cmurzejcx0006mfw9il06935q` |
| billNumber | `MAIN-000066` |
| totalMinor | 299800 |
| subtotalMinor | 260873 |
| paidMinor | 299800 |
| tenantId | `69d8eea5-21b9-4e7e-ba45-fe73f2d345ff` |
| storeId | `595d1ea6-1434-44ec-b00a-0490d7cf8280` |
| customerId | `null` (Walk-in) |
| createdAt | `2026-10-03T05:58:51.777Z` |

**SalePayment — 2 rows, no accidental CASH fallback row**

| id | method | amountMinor | reference | status |
| --- | --- | --- | --- | --- |
| `cmurzejcx0007mfw9qbg9fn41` | CASH | 200000 | `null` | CONFIRMED |
| `cmurzejcy0008mfw9evqyt3yl` | UPI | 99800 | `F9-FINAL-UPI-0001` | CONFIRMED |

```
SUM(amountMinor) = 299800
Sale.totalMinor  = 299800
RECONCILES       = true
payment row count = 2
```

Methods and amounts match the browser interaction exactly.

**SaleItem — 2 rows**, with price/name snapshots: `CCB-001` "Casual Crossbody Bag" ×1 @149900
(taxRateBp 1800, taxMinor 22866) and `CHINO-BEG-32` "Chinos" ×1 @149900 (taxRateBp 1200, taxMinor
16061).

**StockMovement — 2 rows**, both `type=SALE`, `referenceType=SALE`, `referenceId` = the sale id:

| variantId | quantityDelta | balanceAfter | movement idempotencyKey |
| --- | --- | --- | --- |
| `cmu9y4drm009z12ckkbwm1kax` | −1 | 4 | `SALE:cmurzejcx0006mfw9il06935q:cmu9y4drm009z12ckkbwm1kax` |
| `cmu9xxxce001l2ar3jvfeyvrf` | −1 | 13 | `SALE:cmurzejcx0006mfw9il06935q:cmu9xxxce001l2ar3jvfeyvrf` |

**POS / till context:** `Shift — No shift` was active, so no `posSessionId` was sent and none is
recorded. `actorUserId` on both movements is `3d1108e4-33cf-4e23-b886-6acb49c41e4e` (Demo Owner),
and tenant/store scoping is present on the sale, its items and its movements.

**Idempotency key relationship:** `Sale.idempotencyKey` equals the key in the client payload,
`e0060c14-9e68-4131-81b5-ce4b173bf734` — confirmed by the replay in §6 resolving to this same sale.

---

## 6. Duplicate submission

The exact original body replayed with the same idempotency key.

```
BEFORE: {"salesWithKey":1,"saleItems":2,"salePayments":2,"stockMovements":2}
replay HTTP status    = 200
replay duplicate flag = true
replay sale id        = cmurzejcx0006mfw9il06935q   (original: cmurzejcx0006mfw9il06935q)
AFTER : {"salesWithKey":1,"saleItems":2,"salePayments":2,"stockMovements":2}
COUNTS UNCHANGED      = true
```

One sale, two payment rows, two stock movements — stock was not decremented twice. The duplicate
resolved to the original sale rather than erroring, which is the existing idempotency contract.

---

## 7. Cross-screen correlation

**`/sales`** — exact row located by bill number:

```
["", "5", "03 Oct 2026, 11:28 AM", "MAIN-000066", "Walk-in Customer", "2", "₹2,998.00", "CASH", "COMPLETED", "View"]
```

Same identifier, same total, same item count, same customer and store context.

**`/sales/cmurzejcx0006mfw9il06935q`** — the detail view renders both payments in full:

```
Payments against this bill
METHOD  REFERENCE            CONFIRMED              AMOUNT       STATUS
CASH    —                    3 Oct 2026, 11:28 am   ₹2,000.00    Confirmed
UPI     F9-FINAL-UPI-0001    3 Oct 2026, 11:28 am   ₹998.00      Confirmed
```

**`/inventory`** — stock effect from the same sale:

| SKU | Movement `balanceAfter` | `/inventory` shows |
| --- | --- | --- |
| `CHINO-BEG-32` | 13 | **13**, In Stock |
| `CCB-001` | 4 | **0**, Out of Stock |

`CHINO-BEG-32` matches exactly. `CCB-001` reads 0 rather than 4 because the four Phase-G regression
sales in §8 each consumed one more unit of the same variant after this sale; the authoritative
per-sale effect is that sale's movement `balanceAfter = 4`, which is correct.

---

## 8. Payment-method regression

Each method exercised individually through the existing UI, with the real client payload captured.

| Method | Result | Payload keys | Payload |
| --- | --- | --- | --- |
| Cash | `Bill MAIN-000067` | `idempotencyKey, lines, customerId, payment` | `payment={"method":"CASH"}` |
| UPI | `Bill MAIN-000068` | `… payment` | `payment={"method":"UPI"}` |
| Card | `Bill MAIN-000069` | `… payment` | `payment={"method":"CARD"}` |
| More | `Bill MAIN-000070` | `… payment` | `payment={"method":"CASH"}` (documented fallback) |
| **Split** | `Bill MAIN-000066` | `… payments` | **`payments[]`, 2 entries** |

Single-payment behaviour is intact and still uses the original `payment` field. Only SPLIT sends
`payments[]`. Method switching Cash → UPI → Card → Split → More → Cash kept `aria-pressed` correct
and exclusive at every step, and no method disappeared when Split was selected.

---

## 9. Invalid-state behaviour

Browser-observed, with the server contract unchanged. No server validation was weakened.

| Case | Remaining | Complete Sale |
| --- | --- | --- |
| H1 below total (CASH 100 of ₹2,998) | ₹2,898.00 | **disabled** |
| H2 above total, UPI only, no CASH | — | **disabled** |
| H3 zero amounts | ₹2,998.00 | **disabled** |
| H4 negative amount (−500) | ₹3,498.00 | **disabled** |
| H5 incomplete row (row 2 blank) | ₹2,898.00 | **disabled** |
| H6 exact, UPI reference blank | — | enabled |
| H7 above total **with** CASH | ₹500.00 (balance) | enabled |

H6 is correct, not a gap: the reference field is labelled "Ref (Opt)" and is optional in both the
current UI and `createSaleSchema`. There is no UI state that requires a reference, so "missing
required reference" has no case to test. H7 is the existing cash-overpayment semantic, preserved.

Server-side, independently confirmed with fresh idempotency keys:

```
sum below total        → 400 {"code":"validation_error","message":"Insufficient payment."}             0 rows persisted
over total, UPI only   → 400 {"code":"validation_error","message":"Overpayment requires CASH method."} 0 rows persisted
```

---

## 10. Responsive

Split state, two rows populated, at each required viewport.

| Viewport | h-overflow | Remaining | Complete Sale | Add Row | Remove | Rows overlap |
| --- | --- | --- | --- | --- | --- | --- |
| 1536×1024 | none (1536/1536) | visible | visible 365×50 | reachable | reachable | none |
| 1280×1024 | none (1280/1280) | visible | visible 365×50 | reachable | reachable | none |
| 900×1024 | none (900/900) | visible | visible 876×50 | reachable | reachable | none |
| 390×844 | none (390/390) | visible | reachable by pane scroll | reachable | reachable | none |

- No unintended page-level desktop scroll: at 1536×1024 in Split state, `scrollHeight 1024 =
  innerHeight 1024`.
- At 390×844 the checkout pane scrolls, which is the existing F8 mobile behaviour. After
  `scrollIntoView`, Complete Sale measures 366×50 at y=794 and transitions correctly: with Remaining
  `₹1,499.00` it is disabled; after an exact amount it reads `—` and becomes enabled.
- 59 elements extend past 390px, all inside clipped or scrollable containers (the F8 product
  filter-chip row). None belongs to the payment panel, and the document itself does not scroll
  horizontally.
- No CSS `zoom` or `transform` was used to simulate browser zoom.

---

## 11. Accessibility

| Check | Result |
| --- | --- |
| Payment methods are buttons | All five `<button type="button">` |
| `aria-pressed` reflects active method | Split `true`, others `false`; exclusive across all switches |
| Split method selectors labelled | `Payment 1 method`, `Payment 2 method` |
| Split amount inputs labelled | `Payment 1 amount`, `Payment 2 amount` |
| Split reference inputs labelled | `Payment 2 reference` |
| Remove controls have accessible names | `Remove payment 1`, `Remove payment 2` (the `×` glyph is `aria-hidden`) |
| Cash amount field | `<label for="amount-received">Amount Received</label>` |
| Keyboard reachability / order | `Payment 1 amount → Remove payment 1 → Payment 2 method → Payment 2 reference → Payment 2 amount → Remove payment 2 → + Add Payment Row` |
| Visible focus | Complete Sale shows `outlineStyle: auto` on focus |

---

## 12. Console / network

Instrumented with real `pageerror`, `console` (error), `requestfailed` and `response >= 400`
listeners across the full Phase C/G/H run.

```
pageerror     = 0
console.error = 12
requestfailed = 0
http >= 400   = 12
```

All 12 are the same request: `404 GET /images/products/casual-crossbody-bag.jpg`. This is missing
seed media, not F9 — `prisma/seedDemoCatalogue.ts:491` sets
`imageUrl: "/products/casual-crossbody-bag.jpg"` and no such file exists under `apps/web/public/`.
Zero JavaScript errors, zero failed requests.

No `as any` or bare `: any` in `PosTerminal.tsx`, `saleService.ts` or `route.ts`. No credential or
token literal in any F9 file.

---

## 13. Remaining non-blocking / manual items

1. **`/sales` list shows one method for a split sale.** The row for `MAIN-000066` displays `CASH`.
   `saleQueries.ts:41` selects `payments` with `take: 1` and line 66 reads `payments[0].method`, so a
   split sale lists under its first payment only. No data is lost — the sale detail view renders both
   payments correctly (§7) — but the list column is now misleading. Out of F9 scope (Sales screen,
   not the payment UI); worth a follow-up.
2. **No approved visual contract exists for the Split state.** `F9-PAYMENT-DESIGN-SPEC.md` §3 records
   "Split Rows: **NOT SHOWN in source**" and §4 "**NO INTERACTION DESIGN IS SHOWN**";
   `F9-PAYMENT-DISCOVERY.md` closes "F9 = BLOCKED — DESIGN SOURCE MISSING". The current initial state
   is **measured** as two rows, CASH then UPI, but cannot be certified against a reference that does
   not exist. Recorded as observed behaviour, not as a design-conformance pass.
3. **TRUE 90% BROWSER ZOOM = MANUAL VISUAL VERIFICATION REQUIRED.** Playwright cannot set native
   browser zoom, and `deviceScaleFactor` is not equivalent. Not attempted, not simulated.
4. Missing seed asset `public/images/products/casual-crossbody-bag.jpg` (see §12).

---

## 14. Git state

```
branch : main
HEAD   : e5cca5a93f9d37858541133afc11e734343f03a4
```

Tracked modifications:

```
 M apps/web/src/app/(app)/pos/PosTerminal.tsx        163 ++++++++++++++---
 M apps/web/src/test-integration/sales.test.ts       236 +++++++++++-------------
```

`apps/web/next-env.d.ts` appears in `git status` as modified but its content is identical to HEAD —
`git diff --numstat` returns no rows; the flag is a CRLF normalisation artifact. The file is Next.js
generated output, rewritten by `next dev` and restored.

67 untracked files remain in the working tree (`verify-*.cjs`, `pos-check*.png`, `*.out`, `fix_*.js`
and similar). All pre-date this session, none was created, modified or removed here, and none is a
source file. History was not rewritten; nothing was staged or committed.

---

## 15. Closure checklist

| Criterion | Status |
| --- | --- |
| All five sequential commands exit 0 | PROVEN — §3 |
| Repaired split integration tests collected and executed | PROVEN — §1, 4 cases by name, 535 → 539 |
| Real browser Split sale succeeds | PROVEN — §4, `MAIN-000066` |
| Live DB contains the exact resulting split payments | PROVEN — §5, 2 rows, sum 299800 = total |
| Idempotency proven | PROVEN — §6, counts unchanged |
| `/sales` correlates to that transaction | PROVEN — §7 |
| `/inventory` correlates to that transaction | PROVEN — §7 |
| No accidental single-CASH fallback row | PROVEN — §5, §8 |
| Insufficient / invalid overpayment rejected | PROVEN — §9 |
| CASH overpayment semantics preserved | PROVEN — §9 H7 |
| Cash / UPI / Card / Split / More all functional | PROVEN — §8 |
| Responsive Split works | PROVEN — §10 |
| Accessibility passes | PROVEN — §11 |
| Console / network clean | PROVEN — §12 (sole 404 is missing seed media) |
| No new `any`, no credential leakage | PROVEN — §12 |
| Git diff reviewed, no unrelated changes | PROVEN — §14 |
| Split initial-state design conformance | UNVERIFIABLE — §13.2, no approved reference exists |
| True 90% browser zoom | UNVERIFIED — §13.3, manual QA item |

**F9 PAYMENT / SPLIT PAYMENT = CLOSED / GREEN**

**TRUE 90% BROWSER ZOOM = MANUAL VISUAL VERIFICATION REQUIRED**

F10 not started.
