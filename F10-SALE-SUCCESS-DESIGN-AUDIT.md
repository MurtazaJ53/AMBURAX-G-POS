# F10 — Sale Success / Receipt Action: Design & Readiness Audit

**Status:** Discovery only. No application source was modified by this audit.
**Audit date:** 2026-10-03
**Repository HEAD at audit time:** `e5cca5a` (branch `main`)
**Blocking dependency:** F9 Payment / Split Payment is in its final verification gate in a separate session. `apps/web/src/app/(app)/pos/PosTerminal.tsx` and `apps/web/src/test-integration/sales.test.ts` are modified in the working tree and were read but never written by this audit. **No F10 implementation may begin until F9 is CLOSED/GREEN.**

> **Note on sequence:** this audit began with no visual reference in the repository. A reference image was added to `SCREENS/phase-2-screens/` at 11:26 on the audit date, part-way through the audit, and the document below was rewritten around it. §2 records what the reference contains and, more importantly, §2.3 records where it asks for things this system cannot currently supply.

---

## 1. Screen Identity

| Field | Value |
|---|---|
| Screen name | Sale Success / Receipt Action |
| Roadmap number | 18 |
| Roadmap source | `AMBURAX_POS_FINAL_ALL_MD_v8 (1)/SCREEN_MAP.md:23` |
| Route | `/pos` — **no new route required** |
| Design type | Centred modal over a dimmed POS workspace |
| Predecessor | 17 Payment / Split Payment (F9, in verification) |
| Successors already shipped | 19 Sales & Transaction History, 20 Bill / Transaction Details |

The canonical flow that places this screen is `AMBURAX_POS_FINAL_ALL_MD_v8 (1)/FLOWS.md:4`:

```
Scan/Search -> Variant -> Cart -> Customer -> Discount/Tax -> Payment -> Validate -> ERPNext -> Success -> Receipt/View Bill
```

The flow names `ERPNext` as a step before `Success`. ERPNext is **not connected** in the current build (`schema.prisma:1092-1094`), so the real sequence is `Payment -> Validate -> Success (erpSyncStatus = PENDING) -> Receipt/View Bill`. This matters directly: the reference image prints an `Invoice No.` that only ERPNext can issue. See §2.3.

---

## 2. Approved Visual Reference

**File:** `SCREENS/phase-2-screens/ChatGPT Image Oct 3, 2026, 11_26_53 AM.png`
**Added:** 2026-10-03 11:26, during this audit.
**Status:** The only visual reference for screen 18 in the repository.

Earlier searches, recorded here because they establish that this one file is the whole reference set and nothing else was missed: `SCREENS/phase-1-screens/` holds only A1–A14; the other eight images in `SCREENS/phase-2-screens/` are Dashboard, bill details, catalogue, customer CRM, customer due, inventory, pos-checkout and sales; `grep -ri "sale success\|receipt action"` across all 51 reference `.md` files returns one hit, the `SCREEN_MAP.md:23` roadmap line; `SCREEN_SPECIFICATIONS.md`, `SCREEN_STATE_MATRIX.md`, `SCREEN_API_MATRIX.md` and `WIREFRAMES.md` contain no screen-18 section. **There is no written specification for this screen — the image is the entire brief.**

### 2.1 Layout

A centred modal over the POS workspace. The workspace stays mounted and visible behind a dim: the catalogue is readable on the left, and the **cart panel on the right still shows all four line items, the totals and the payment method row**. The modal has a close control (`×`, top-right) and is two columns:

**Left column — confirmation and actions**

| Element | Reference detail |
|---|---|
| Success mark | Large green circle with white check, pale green fill, scattered confetti dots (blue, green, amber, lilac) |
| Headline | `Sale Completed!` — large, bold, near-black |
| Subhead | `Bill generated successfully` — grey, regular |
| Meta strip | One rounded light-grey panel, four labelled cells: **Bill No.** `POS-20241324` (with a copy icon), **Date & Time** `26 Aug 2024 / 10:24 AM`, **Total Amount** `₹3,199`, **Items** `4` |
| Action 1 | `Print Receipt (F3)` — full-width, **solid blue**, printer icon |
| Action 2 | `Download PDF` — full-width, white, bordered |
| Actions 3 & 4 | `Share via WhatsApp` \| `Email Receipt` — side by side, half width each, white, bordered |
| Action 5 | `View Bill Details` — full-width, white, bordered |
| Action 6 | `Return / Exchange` — full-width, white, bordered |
| Action 7 | `New Sale (F2)` — full-width, white, bordered, blue text and plus icon |

**Right column — receipt preview**

Rendered as a paper receipt: white, zigzag torn edges top and bottom, dashed rules between sections.

| Block | Fields shown |
|---|---|
| Header | `ATELIER RETAIL` (store/brand), `Garment POS`, store name + code `Indiranagar Store ( #01 )`, street address, city + postcode, `GSTIN: 29ABCDE1234F1Z5` |
| Identity | `Bill No.` `POS-20241324`, **`Invoice No.` `SINV-24-008521`**, `Date & Time`, `Cashier` `Ravi Kumar`, **`Sales Person` `Amit Sharma`**, `Customer` `Ali Khan (AK)` |
| Items table | Columns `#`, `Item`, `Qty`, `Price`, `Total`. Each row has a second line: `SH-001 \| M / Blue` — SKU, size, colour |
| Totals | `Subtotal ₹3,047`, `Item Discount −₹150`, `GST (5%) ₹152`, rule, `Total (4 items) ₹3,199` |
| Payments | `Payment Details`, numbered rows: `1 UPI  UPI/4269873124  ₹2,500`, `2 Cash  −  ₹699` |
| Footer | **Barcode** encoding the bill number, with `POS-20241324` printed beneath |

### 2.2 What the reference confirms about the current build

Three current behaviours are **vindicated** by the reference and must be preserved:

- A modal over `/pos`, not a new route. The existing component is already an in-`/pos` overlay.
- `View Bill Details` deep-links out to the bill screen — the reference does **not** make the success modal the system of record for the bill. `/sales/{id}` keeps that job.
- `New Sale` resets in place. The existing `startNewSale()` already does exactly this.

Two current behaviours **conflict** with the reference and must change:

- **Primary colour.** The reference's primary action is **solid blue** (`Print Receipt`), matching `docs/frontend/DESIGN-SYSTEM.md`'s documented `blue-600` primary. The shipped component uses `emerald-600` for `Start New Sale`. **Follow the reference: blue primary, and the primary action is Print, not New Sale.**
- **The workspace stays mounted.** The reference dims the POS but keeps the cart, its line items and its totals fully visible. The shipped component early-returns and **unmounts the entire terminal** (`PosTerminal.tsx:369-374`). This is a real behavioural change, and it interacts with `startNewSale()` — the cart must survive until the operator dismisses or starts a new sale.

### 2.3 Where the reference asks for things this system cannot supply

This is the most important section of the audit. Seven elements in the image have **no backend behind them**. Shipping them would mean shipping controls and figures that are decorative or false.

| Reference element | Reality | Classification |
|---|---|---|
| **`Invoice No. SINV-24-008521`** | `Sale.erpInvoiceId` is nullable and always `null` — ERPNext is not connected. Invoice numbering is ERPNext-authoritative (ADR-063 / ADR-079), and `billNumber` is explicitly *not* an invoice number (`schema.prisma:1071-1073`). **Printing a fabricated invoice number on a customer's receipt is a tax-document falsification risk, not a cosmetic gap.** | **MUST OMIT** |
| **`GSTIN: 29ABCDE1234F1Z5`** (seller's) | No store-level GSTIN field exists. `Store` has `name, code, storeType, currency, phone, addressLine, city, state, postalCode, timezone, isDefault, erpnext*` — no tax registration. `Tenant.taxId` (`schema.prisma:76`) is nullable and tenant-wide, not per-store. `Customer.gstin` (`schema.prisma:798`) is the *buyer's*, not the seller's. | **MISSING** (tenant-level fallback possible, see §6) |
| **`Sales Person: Amit Sharma`** (distinct from Cashier) | `Sale` records `cashierUserId` only. There is no sales-attribution field and no commission model. | **MISSING** |
| **`Download PDF`** | No PDF generator, no export endpoint, no dependency. | **MISSING** |
| **`Share via WhatsApp`** | No WhatsApp integration, no `navigator.share` anywhere in `apps/web/src`. | **MISSING** |
| **`Email Receipt`** | No transactional e-mail dispatch for receipts. | **MISSING** |
| **`Return / Exchange`** | Screens 22 and 23 are unbuilt. No route, no service, no eligibility rules. The button would navigate nowhere. | **MISSING** |
| **Barcode** | No barcode library in `apps/web/package.json`. | **MISSING** (addable — a small dependency, but a scope decision, not an assumption) |
| **`Item Discount −₹150`** | Exists, but in two places: `Sale.discountMinor` (order-level) and `SaleItem.lineDiscountMinor` (per line). The reference's single "Item Discount" row must be defined as one or the sum of the other. | **AMBIGUOUS — needs owner decision** |
| **`SH-001 \| M / Blue`** sub-lines | `SaleItem` snapshots `skuSnapshot` and `nameSnapshot` **only** — size and colour are **not** snapshotted. `ProductVariant.size` and `ProductVariant.colour` exist (`schema.prisma:746-747`) and can be joined live, but a later edit to the variant would retroactively change what a past receipt says it sold. That is the exact failure `SaleItem`'s snapshot design exists to prevent (`schema.prisma:1137-1146`). | **PARTIAL — architecturally inconsistent** |

**The standing rule in this codebase already covers most of this.** `apps/web/src/app/(app)/sales/[id]/PrintButton.tsx` carries this comment verbatim:

> *"Deliberately the only receipt action offered: e-mail, PDF export and WhatsApp share all appear in the design reference and none of them exist, so shipping those buttons would mean shipping three controls that silently do nothing."*

A previous screen faced this identical reference and resolved it by shipping Print alone. **F10 should resolve it the same way unless the owner decides otherwise** — see §14 Q1.

### 2.4 Keyboard shortcuts

The reference labels `Print Receipt (F3)` and `New Sale (F2)`, and the payment panel behind shows `Complete Sale (F9)`. No keyboard shortcut system exists in `/pos` today. Shortcuts are **cheap to add and genuinely useful at a till**, but they are a new interaction surface: they need a documented map, they must not fire while a text input has focus, and F-keys collide with browser defaults (F3 is find-in-page in several browsers). Treat as a scoped sub-task, not a label to paint on.

---

## 3. Backend Readiness

Classification key: **REAL** = exists, authoritative, queryable today. **PARTIAL** = exists but not reachable from the sale-completion response. **MISSING** = no implementation. **NOT AUTHORITATIVE** = exists but must not be presented as a confirmed system-of-record value.

| Item | Class | Evidence |
|---|---|---|
| Completed Sale record | **REAL** | `Sale` model, `schema.prisma:1066`. `status SaleStatus @default(COMPLETED)`. |
| Sale ID | **REAL** | `Sale.id` cuid. Returned in `SaleSummary` (`saleService.ts:87`). |
| Bill number | **REAL** | `Sale.billNumber`, allocated from `Store.nextBillSeq` inside the sale transaction under a row lock (`schema.prisma:1071-1073`, `156-181`). `@@unique([storeId, billNumber])`. Returned in `SaleSummary`. |
| Invoice number (ERPNext) | **MISSING / NOT AUTHORITATIVE** | `Sale.erpInvoiceId` always null. See §2.3 — the reference shows one and it must be omitted. |
| Customer | **PARTIAL** | `Sale.customerId` persisted; `getSaleDetail` returns `{ name, phone }`. **Not in the create-sale response** — the current screen uses client-side `customer?.name` (`PosTerminal.tsx:372`). Note the reference also shows initials `(AK)` — derivable from the name. |
| Customer GSTIN | **REAL (unused)** | `Customer.gstin`, `schema.prisma:798`. Not selected by `getSaleDetail` today; one line to add. |
| Seller GSTIN | **MISSING** | No store-level field. `Tenant.taxId` is the only candidate. |
| Totals (subtotal/discount/tax/total) | **REAL** | All four on `Sale` (`schema.prisma:1082-1085`), server-calculated from stored variant price, all four in `SaleSummary`. |
| Paid amount | **REAL** | `Sale.paidMinor`, in `SaleSummary`. |
| Change / balance due | **PARTIAL (derivable)** | **No `changeMinor` column.** Change = `paidMinor - totalMinor`, from two authoritative fields already in the response. No schema change needed. **Note: the reference does not show change due at all** — see §4 and §14 Q2. |
| Item count | **REAL (derivable)** | `items.length` / sum of quantities from `getSaleDetail`. The reference shows both `Items 4` and `Total (4 items)`. Define which. |
| Payment breakdown | **PARTIAL** | `SalePayment` is 1-to-many (`schema.prisma:1164-1180`), F9 populates it, `getSaleDetail` returns the full array with `method`, `amountMinor`, `reference`, `status`, `confirmedAt`. **The create-sale response collapses it to `payments[0].status`** (`saleService.ts:107`). The reference's two-row UPI + Cash panel needs `getSaleDetail`. |
| Store name / code / address | **PARTIAL** | `getSaleDetail` returns `storeName`, `storeCode`. **Address is not selected** — `Store.addressLine`, `city`, `state`, `postalCode` exist and would need adding to the select. |
| Cashier | **PARTIAL** | `getSaleDetail` returns `cashierName`. |
| Sales person | **MISSING** | No field, no model. |
| Terminal / till | **PARTIAL** | **`Sale` has no `terminalId`.** It has nullable `posSessionId` (`schema.prisma:1111-1116`) pointing at `PosSession`, which belongs to a `PosDevice`. Reachable by join; legitimately null for a back-office sale. The reference does not show a terminal, so this stays out of scope. |
| Timestamp | **REAL** | `Sale.completedAt`. Store timezone on `Store.timezone` (default `Asia/Kolkata`). |
| Line items | **PARTIAL** | `SaleItem` holds price snapshots — correct for a receipt. `getSaleDetail` returns them with `imageUrl`. Size and colour are **not** snapshotted (§2.3). |
| Receipt header / footer text | **REAL (unwired)** | `PosDevice.receiptHeader`, `PosDevice.receiptFooter` (`schema.prisma:279-280`), configured at A9. **Nothing reads them anywhere in the app.** The reference's header block is store identity, not this free text — the two are different things and both exist. |
| Receipt generation (server-rendered document) | **MISSING** | No renderer, no template, no service. The nearest thing is `/sales/[id]`. |
| Print | **PARTIAL** | `PrintButton.tsx` — `window.print()` only, with `print:hidden` chrome suppression. **No `@media print` block in `globals.css`**; rules are per-element Tailwind `print:` variants on the bill page. No print support in `/pos`. |
| Download / PDF, Share, E-mail | **MISSING** | See §2.3. |
| Barcode | **MISSING** | No library in `apps/web/package.json`. |
| Reprint | **PARTIAL** | Via `/sales/{id}` + Print. No dedicated action, no reprint audit trail. |
| Return / Exchange | **MISSING** | Screens 22/23 unbuilt. No route. |
| Transaction lookup | **REAL** | `getSaleDetail({ tenantId, saleId })` (`saleQueries.ts:265`) — tenant-scoped, returns `null` for a foreign id so an unknown and a foreign id are indistinguishable. |
| Idempotency | **REAL** | `Sale.idempotencyKey`, `@@unique([tenantId, idempotencyKey])` (`schema.prisma:1088-1090`, `1118`). API returns `duplicate: true` with HTTP 200 instead of 201 (`route.ts:217-224`). Client regenerates only in `startNewSale()` (`PosTerminal.tsx:283`). |
| Stock effect | **REAL but NOT AUTHORITATIVE** | `applyStockMovement` in the sale transaction (`saleService.ts:369`). `StockLevel` is an operational projection, not a ledger (`schema.prisma:1182-1189`). |
| Event emission | **REAL** | `enqueueOutboxEvent` in the same transaction (`saleService.ts:383`). |
| ERP sync status | **REAL (value) / UNWIRED (display)** | `Sale.erpSyncStatus` defaults to `PENDING`, **is** in `SaleSummary`, **is** captured into `CompletedSale` state (`PosTerminal.tsx:47`) — and is **never rendered**. Schema is explicit: *"the UI must say 'ERP sync pending', never 'posted to ERPNext'."* The reference does not show it. **It is required anyway**, and its absence from the reference is precisely why the reference also shows an invoice number that does not exist. |

### The single structural backend gap

`createSale` returns `SaleSummary` (`saleService.ts:86-99`) — totals and identifiers only. No customer, store, cashier, line items or payment breakdown. The reference's receipt preview needs all of them.

- **Option A (recommended): read `getSaleDetail` after completion.** Already returns nearly everything the receipt needs, already tenant-scoped, already proven by `/sales/[id]`. Needs three additive fields on its `select` — store address, `customer.gstin`, and variant `size`/`colour` — which change no contract and no schema. Cost: one round-trip, once per sale.
- **Option B: widen `createSale`'s response.** Changes a contract F9 is mid-verification on, duplicates the select, forces re-verification of F9's integration tests. **Reject for F10.**

**Decision: Option A. No migration. No change to `createSale`'s contract.** This is what makes F10 safe to start the moment F9 closes — it touches nothing F9 touched on the server.

---

## 4. Frontend Trace — What Happens After "Complete Sale" Today

Read from `apps/web/src/app/(app)/pos/PosTerminal.tsx` at HEAD `e5cca5a` (F9 working state).

```
[1] Button          line 743-750
                    <button onClick={completeSale}> "Complete Sale" / "Completing..."
                    Disabled while `submitting`; label single-sourced so it cannot
                    contradict itself (comment at line 720).

[2] Guard           line 288-303
                    Returns early if cart empty or already submitting.
                    CASH: rejects amountReceived < total.
                    SPLIT: rejects splitRemainingMinor > 0.
                    Sets submitting = true, clears prior saleError.

[3] Payload build   line 318-346
                    SPLIT  -> payments[] (rows with amount > 0 only; zero rows dropped)
                    others -> payment{} single tender; MORE falls back to CASH
                    idempotencyKey from useRef, generated once per cart (line 120-125)

[4] Request         line 331  POST /api/v1/sales, content-type application/json

[5] Server          api/v1/sales/route.ts
                    correlationId from x-correlation-id header or randomUUID (line 84)
                    zod parse (line 99)          -> 400 on bad shape
                    resolvePosContext (line 110) -> 401 unauthorized / no_store
                    createSale (line 114)
                    capability_disabled          -> 404, deliberately not 403 (comment 133-138)
                    ok                           -> 201, or 200 + duplicate:true (line 217-224)
                    throw                        -> 503 "Nothing was charged" (line 231-234)

[6] Response read   line 346-352
                    !res.ok -> setSaleError(data.error.message); returns.
                    `finally { setSubmitting(false) }` runs, so the button re-enables.

[7] State change    line 353-360
                    setCompleted({ id, billNumber, totalMinor, paidMinor,
                                   erpSyncStatus, duplicate })

[8] Success UI      line 369-374
                    if (completed) -> early return, replaces the ENTIRE terminal with a
                    z-50 overlay containing <SaleSuccess>.
                    Cart, payment panel and catalogue are UNMOUNTED, not dimmed.
                    >>> This contradicts the reference, which keeps them visible. <<<

[9] Navigation      line 982-989
                    "Start New Sale" -> startNewSale(): clears cart, customer, method,
                       reference, amountReceived, completed, errors, query;
                       regenerates idempotencyKey; refocuses search input. No route change.
                    "View Receipt"   -> <Link href={`/sales/${id}`}>. Leaves /pos.

[10] Receipt action Nothing else. No print, no receipt preview, no payment breakdown,
                    no ERP sync notice, no close control, no shortcuts.
```

### Current component versus reference

| Reference element | Current state |
|---|---|
| Modal over dimmed, still-mounted workspace | **Conflict** — terminal is unmounted |
| Close `×` control | **Absent** |
| Confetti success mark | Plain check circle, no confetti |
| `Sale Completed!` + `Bill generated successfully` | Says `Payment Successful`, no subhead |
| Meta strip: Bill No / Date & Time / Total / Items | Bill No and total only; no date, no item count |
| Copy-bill-number icon | **Absent** |
| `Print Receipt (F3)` as blue primary | **Absent**; primary is emerald `Start New Sale` |
| `Download PDF` / `WhatsApp` / `Email` | **Absent** — and no backend (§2.3) |
| `View Bill Details` | Present as `View Receipt` |
| `Return / Exchange` | **Absent** — and no backend |
| `New Sale (F2)` | Present as `Start New Sale`, no shortcut |
| Receipt preview column | **Entirely absent** |
| Payment breakdown rows | **Absent** |
| Barcode | **Absent** — no library |

### Frontend gaps not visible in the reference but required anyway

| Gap | Severity | Evidence |
|---|---|---|
| **`erpSyncStatus` captured but never rendered**, violating the explicit schema instruction that the UI must say "ERP sync pending". The reference does not show it, which is exactly why this must be caught here. | **HIGH** | Value at `PosTerminal.tsx:47`; absent from JSX. Rule at `schema.prisma:1092-1094`. |
| **Change due is never shown**, and the reference does not show it either. For a cash sale this is the number the cashier physically acts on. The reference's example is a UPI+Cash split that happens to settle exactly, which is likely why it is absent from the image rather than a decision to omit it. | **HIGH — needs owner ruling** | `paidMinor` and `totalMinor` both already in state. See §14 Q2. |
| **Customer name comes from client cart state, not the sale record.** | **MEDIUM** | `PosTerminal.tsx:372`. |
| **No `data-testid` anywhere in `SaleSuccess`.** The only test id in the entire 993-line file is `split-remaining`. F10's browser verification has no stable hooks. | **MEDIUM** | `grep -o 'data-testid="[^"]*"'` returns one result. |
| **Overlay is `absolute inset-0` inside a scrollable parent** (`h-[calc(100vh-68px)] overflow-y-auto`). Whether it covers the viewport when the workspace has been scrolled is **unverified**. Moving to a dimmed-but-mounted modal makes this more important, not less. | **MEDIUM — unverified** | `PosTerminal.tsx:370` vs parent at line 377. |

### Pre-existing unrelated defect noted in passing

`apps/web/src/app/(app)/sales/page.tsx:93` links to `/sales/export`. **That route does not exist** (`apps/web/src/app/(app)/sales/` contains only `[id]`, `_components`, `actions.ts`, `formatDateTime.ts`, `page.tsx`). Dead link in shipped F7 work, outside F10's scope. **Recorded so it is not lost; do not fix it inside F10.**

---

## 5. Cross-Screen Consistency

| Target | Current linkage | Required for F10 |
|---|---|---|
| `/sales` (19, shipped) | Sale appears in `listSalesPage`, tenant- and store-scoped, ordered by `completedAt`. | **Verify correlation only:** the bill number on the modal appears in `/sales` immediately. |
| `/sales/{id}` (20, shipped) | `View Receipt` deep-links here; `getSaleDetail` powers it. The reference's `View Bill Details` is the same action. | **Preserve.** The modal's receipt preview is a preview — `/sales/{id}` remains the system of record. Do not fork the bill layout into two divergent implementations. |
| `/inventory` (24, shipped) | `applyStockMovement` runs inside the sale transaction (`saleService.ts:369`). | **Verify correlation only:** sold quantity decrements. The modal must make no claim about global stock (`schema.prisma:1182-1189`). |
| Customer data (37/38) | `Sale.customerId` with composite FK, `onDelete: Restrict`. | Source the displayed customer from `getSaleDetail().customer`, not cart state. |
| Returns (22/23, unbuilt) | Nothing exists. | The reference's `Return / Exchange` button has no destination. **Omit.** |
| POS terminal context | `PosContext` gives `storeName`, `storeCode`, `userName`, `membershipRole`, `canSell`, server-resolved. | Store identity for the receipt header comes from `getSaleDetail`, not from client context. |
| `/till` (shift) | `PosSession` tracks the shift; `Sale.posSessionId` set when open. | No F10 change. |

---

## 6. Required Components

All additions live inside the existing `/pos` route. **No new route. No new page file. No new layout.**

| Component | Type | New or extend | Notes |
|---|---|---|---|
| `SaleSuccess` | client | **extend** `PosTerminal.tsx:951` | Becomes a two-column modal. Keep it a dialog over a dimmed, still-mounted workspace. |
| Modal shell | markup | change | Dim the workspace instead of unmounting it. Add the `×` close control. Close returns to the cart as it was; it must **not** silently start a new sale. |
| Meta strip | markup | new | Bill No (with copy-to-clipboard), Date & Time in store timezone, Total, Item count. |
| Receipt preview | markup | new | Store header, identity block, item table with SKU sub-lines, totals, payment rows. **No invoice number. No seller GSTIN unless §14 Q3 is resolved. No barcode unless §14 Q4 is resolved.** |
| Payment breakdown | markup | new | One row per `SalePayment`: method, reference when present, amount. |
| ERP sync notice | markup | new | Wording fixed by `schema.prisma:1092-1094`: "ERP sync pending". Never "posted". Not in the reference; required regardless. |
| Change due | markup | new, conditional | `paidMinor - totalMinor` when positive. Pending §14 Q2. |
| Print action | client | new | Blue primary. `window.print()` + `print:` rules scoped so **only the receipt column prints** — the action column and the dimmed workspace must be `print:hidden`. Mirrors `PrintButton.tsx`. |
| `View Bill Details` | client | rename | Existing `View Receipt` link, relabelled to match the reference. |
| `New Sale` | client | keep | Existing `startNewSale()`. Relabel per reference. |
| Sale detail fetch | server/client | new | `getSaleDetail` with three additive `select` fields: store address, `customer.gstin`, variant `size`/`colour`. See §3 Option A. |
| Keyboard shortcuts | client | new, scoped | F2/F3 only if §14 Q5 says yes. Must not fire while a text input has focus. |

### Explicitly out of scope for F10

`Download PDF`, `Share via WhatsApp`, `Email Receipt`, `Return / Exchange`, `Invoice No.`, `Sales Person`, terminal name, reprint audit trail, thermal-printer stylesheet, receipt template editor. **Every one is MISSING with no backend.** The codebase has already ruled on this exact list once, in `PrintButton.tsx`'s comment. Do not stub them, do not disable-and-show them, do not add tooltips promising them.

---

## 7. Dependencies

**Backend (all existing — no migration, no new endpoint):**
- `getSaleDetail` — `apps/web/src/server/sales/saleQueries.ts:265` (three additive `select` fields)
- `resolvePosContext` — `apps/web/src/server/sales/posContext.ts`
- `createSale` / `SaleSummary` — `apps/web/src/server/sales/saleService.ts:143`, `:86` — **unchanged**
- `POST /api/v1/sales` — `apps/web/src/app/api/v1/sales/route.ts` — **unchanged**

**Frontend:**
- `PosTerminal.tsx` — the F9 file. **Hard-blocked until F9 closes.**
- `formatMinor` — already used
- `lucide-react` — `CheckCircle2`, `Printer`, `X`, `Copy`, `FileText` all available
- `next/link` — already imported

**Data:** no new tables, no new columns, no migration.

**Possible new dependency:** a barcode renderer, only if §14 Q4 approves it. Default assumption: **no new dependency.**

---

## 8. Implementation Sequence

Each step independently verifiable. Do not merge steps.

0. **Confirm F9 is CLOSED/GREEN.** Re-read `PosTerminal.tsx` and `sales.test.ts` at the post-F9 commit. **If F9 is not closed, stop.**
1. **Resolve §14 Q1–Q5 with the owner.** Several decide whether elements ship at all; building first and asking later means building something that must be torn out.
2. Capture pre-change screenshots of the current success screen at all four widths — the regression baseline.
3. Add `data-testid` hooks to `SaleSuccess`. No visual change. Verify pixel-identical.
4. Convert the overlay from unmount-and-replace to dim-and-mount, add the `×` close. Verify the cart survives, close does not start a new sale, and `startNewSale()` still clears everything.
5. Wire the sale-detail read with the three additive `select` fields. Verify the payload in the network panel. **No UI change yet.**
6. Rebuild the left column: confetti mark, headline, subhead, meta strip with copy action.
7. Build the receipt preview column — **with the §2.3 omissions**.
8. Add the payment breakdown. Verify against an F9 split sale: every `SalePayment` row appears, amounts sum to `paidMinor`.
9. Add the ERP sync notice. Verify the string is "ERP sync pending" and never claims a post.
10. Add change due, if §14 Q2 approves.
11. Add the print action and print rules. Verify the preview prints the receipt column only.
12. Add F2/F3 shortcuts, if §14 Q5 approves.
13. Full gate run: §9.
14. **Stop.** Do not continue to screen 21.

---

## 9. Verification Gates

Every gate must pass. A failure stops the screen.

**Commands (from `apps/web/`):**
```
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run build
```
*(Confirm exact script names against `apps/web/package.json` first — this audit did not execute them.)*

**Database correlation (read-only queries):**
- On-screen bill number equals `Sale.billNumber` for the returned `Sale.id`.
- Subtotal, discount, tax, total and paid each equal their `Sale` column.
- Every payment row matches a `SalePayment` row for that `saleId`; the count matches exactly; amounts sum to `paidMinor`.
- Every item row matches a `SaleItem` row; quantities and line totals match.
- Change figure, if shown, equals `paidMinor - totalMinor`.
- `Sale.erpSyncStatus` is `PENDING` and the UI says pending.
- `Sale.tenantId` equals the session's tenant.

**Absence gates — these are pass/fail, not cosmetic:**
- No invoice number anywhere in the rendered modal or its print output.
- No seller GSTIN unless §14 Q3 approved a source, in which case it matches that field.
- No `Download PDF`, `WhatsApp`, `Email` or `Return / Exchange` control in the DOM — not hidden, not disabled, **not present**.
- No sales-person row.

**`/sales` correlation:** the sale appears in the list with the same bill number and total.
**`/sales/{id}` correlation:** `View Bill Details` resolves; every figure matches the modal.
**`/inventory` correlation:** the sold variant's `StockLevel` decremented by the sold quantity; the modal makes no claim about global stock.

**Idempotency:** double-click Complete Sale, and replay the request. Exactly one `Sale` row. Second response HTTP 200 with `duplicate: true`. The duplicate notice shows. **One sale, one bill number.**

**Tenant isolation:** a second tenant's session cannot read the first tenant's sale through the new read path. `getSaleDetail` returns `null` for a foreign id — verify this holds on the new call path, including the three added `select` fields.

**Authorization:** a user without a selling role cannot reach the modal. `canSell` unchanged.

**Print:** print preview shows the receipt column only; action buttons, modal chrome and the dimmed workspace are all suppressed.

**No mock data:** grep the final diff for fixtures, placeholders and hardcoded money. Every figure traces to a database field or to arithmetic on database fields. **Specifically confirm that none of the reference image's sample values — `POS-20241324`, `SINV-24-008521`, `29ABCDE1234F1Z5`, `ATELIER RETAIL`, `Ravi Kumar`, `Amit Sharma`, `Ali Khan`, `₹3,199` — appears anywhere in the source.**

---

## 10. Responsive QA Matrix

The reference is a desktop composition. It gives no tablet or phone state, so the narrow layouts are a judgement call, not a reproduction — record what was decided.

| Width | Checks |
|---|---|
| **1536 × 1024** | Two-column modal as referenced; centred; workspace dimmed and readable behind; no horizontal scroll; every action reachable. |
| **1280** | Same two columns; receipt column does not compress item rows into wrapping; totals stay right-aligned. |
| **900** | POS has collapsed from `lg:flex-row` to `flex-col`. **Verify the modal still covers the workspace and is not clipped by the parent's `overflow-y-auto`.** Decide and record: columns stack, or receipt preview collapses behind a toggle. |
| **390** | Modal fits with margin; buttons full-width and at least 44px tall; the receipt column must remain legible or be collapsible — a receipt squeezed to 390px with five table columns will not read. **Verify the modal covers the viewport even when the workspace was scrolled before completion** (flagged unverified in §4). |

Screenshot each width as `f10-success-{width}.png`. Also capture the print preview at 1536.

---

## 11. Accessibility Checks

- The modal is a real dialog: `role="dialog"`, `aria-modal="true"`, labelled by the `Sale Completed!` heading. Today it is none of these.
- Focus moves into the modal on open and lands on the primary action (`Print Receipt`). Today focus is not moved.
- Focus is trapped while open; `Escape` closes it, with the same semantics as the `×` — returns to the cart, does not start a new sale.
- Focus returns to a sensible element on close.
- `Sale Completed!` is an `h2`; the page already has an `h1`. No level skipped.
- Every action is keyboard-reachable with a visible focus ring (`focus-visible:outline-2`, the existing pattern).
- Success is announced to assistive technology, not conveyed by the green check alone.
- The duplicate notice is announced, not merely coloured amber.
- The receipt table is a real `<table>` with headers, not a grid of `<div>`s, so it is navigable by screen reader.
- Amounts read as currency, not bare digits.
- The copy-bill-number control has an accessible name and announces success.
- Contrast: `text-slate-500` on `bg-slate-50` verified at 4.5:1 in the meta strip; the dimmed backdrop must not reduce modal contrast.
- If F-key shortcuts ship, they are an enhancement — every action stays reachable by Tab, and the shortcut is announced in the button's accessible name.

---

## 12. Regression Checks

- F9 payment panel unchanged: method selection, quick amounts, split rows, remaining balance, the `Complete Sale` enable rule.
- `startNewSale()` still clears every field and regenerates the idempotency key.
- Closing the modal without starting a new sale leaves the cart and idempotency key intact — **a second Complete Sale with the same key must still return the same sale, not a new one.**
- Cart, catalogue, search and customer picker unaffected.
- `/sales` and `/sales/{id}` untouched.
- `PrintButton.tsx` untouched.
- No change to `createSale`, `SaleSummary`, `POST /api/v1/sales`, or `schema.prisma`.
- `sales.test.ts` — F9's file — not modified by F10.
- F8 POS geometry gates (`qa-pos-geometry.cjs`) still pass. **The dim-instead-of-unmount change puts the workspace back on screen during success, so these gates are now genuinely at risk — run them, do not assume.**

---

## 13. Implementation Prompt (use after F9 is CLOSED/GREEN)

> **AMBURAX F10 — Sale Success / Receipt Action**
>
> **Precondition:** F9 Payment / Split Payment must be CLOSED/GREEN. Before writing code, re-read `apps/web/src/app/(app)/pos/PosTerminal.tsx` and `apps/web/src/test-integration/sales.test.ts` at the current commit. If F9 is not closed, stop and report.
>
> **Read first:** `F10-SALE-SUCCESS-DESIGN-AUDIT.md`. It is the authoritative scope, and §2.3 overrides the reference image wherever they disagree.
>
> **Screen:** Sale Success / Receipt Action (roadmap screen 18, `SCREEN_MAP.md:23`).
> **Route:** `/pos`. **Create no new route, no new page file, no new layout.**
>
> **Approved reference:** `SCREENS/phase-2-screens/ChatGPT Image Oct 3, 2026, 11_26_53 AM.png`. Follow its layout: a centred two-column modal over a **dimmed but still-mounted** POS workspace; left column = confetti success mark, `Sale Completed!`, `Bill generated successfully`, a meta strip (Bill No with copy, Date & Time, Total, Items), then the action stack; right column = a paper-styled receipt preview with a `×` close control.
>
> **Extend the existing `SaleSuccess` at `PosTerminal.tsx:951-993`. Do not delete and rewrite it.** Keep `startNewSale()` and the `/sales/{id}` link — the reference confirms both.
>
> **Design system:** `docs/frontend/DESIGN-SYSTEM.md` — `slate-50` app background, `white` cards, `slate-900`/`slate-500` text, `emerald` success, `amber` warning, `rounded-2xl`/`rounded-lg`, Inter. The reference's primary action is **solid blue** (`Print Receipt`), which matches the documented `blue-600` primary — switch the primary from the current emerald `Start New Sale` to blue `Print Receipt`. Keep emerald for the success mark only.
>
> **DO NOT BUILD these, even though the reference shows them. Each has no backend and §2.3 records the evidence:**
> - **`Invoice No.`** — `Sale.erpInvoiceId` is always null; ERPNext is not connected; invoice numbering is ERPNext-authoritative (ADR-063/ADR-079). Printing a fabricated invoice number on a customer receipt is a tax-document falsification risk. **Omit entirely.**
> - **Seller `GSTIN`** — no store-level field exists. Omit unless the owner has answered §14 Q3.
> - **`Sales Person`** — no field, no model. Omit.
> - **`Download PDF`**, **`Share via WhatsApp`**, **`Email Receipt`** — no generator, no integration, no dispatch. Omit.
> - **`Return / Exchange`** — screens 22/23 unbuilt, no route. Omit.
> - **Barcode** — no library. Omit unless the owner has answered §14 Q4.
>
> **Omit means absent from the DOM — not hidden, not disabled, not tooltipped as "coming soon".** `apps/web/src/app/(app)/sales/[id]/PrintButton.tsx` already states this rule for this exact list of controls; follow it.
>
> **Build, in this order, verifying each step before the next:**
> 1. Baseline screenshots of the current success screen at 1536, 1280, 900, 390.
> 2. Add `data-testid` hooks. No visual change.
> 3. Convert from unmount-and-replace to dim-and-mount; add `×` close. The cart must survive; close must **not** start a new sale or regenerate the idempotency key.
> 4. Read the sale through the **existing** `getSaleDetail` (`apps/web/src/server/sales/saleQueries.ts:265`), adding only three fields to its `select`: store address (`addressLine`, `city`, `state`, `postalCode`), `customer.gstin`, and variant `size`/`colour`. **Do not widen `createSale`'s response. Do not change `SaleSummary`. Do not add an endpoint. Do not migrate the schema.**
> 5. Left column: success mark, headline, subhead, meta strip with copy-to-clipboard on the bill number.
> 6. Receipt preview column, with the omissions above.
> 7. Payment breakdown — one row per `SalePayment` (method, reference when present, amount).
> 8. ERP sync notice. The wording must be **"ERP sync pending"**. Never state or imply anything was posted to ERPNext — `schema.prisma:1092-1094` makes this a hard rule. The reference omits this; it is required anyway.
> 9. Change due (`paidMinor - totalMinor`, when positive) — only if the owner approved §14 Q2.
> 10. Print: `window.print()` plus `print:` rules scoped so **only the receipt column prints**; actions, modal chrome and the dimmed workspace are `print:hidden`. No thermal-printer stylesheet.
> 11. F2/F3 shortcuts — only if the owner approved §14 Q5. Must not fire while a text input has focus.
>
> **Hard constraints:**
> - Every displayed value comes from a real `Sale`, `SaleItem`, `SalePayment`, `Customer` or `Store` record, or arithmetic on such fields. **No fixtures, no mocks, no placeholder money, no hardcoded bill numbers.** None of the reference's sample values (`POS-20241324`, `SINV-24-008521`, `29ABCDE1234F1Z5`, `ATELIER RETAIL`, `Ravi Kumar`, `Amit Sharma`, `Ali Khan`, `₹3,199`) may appear in source.
> - **Size/colour sub-lines are joined live from `ProductVariant`, not snapshotted on `SaleItem`.** A later variant edit would retroactively alter a past receipt. Note this limitation in a code comment where it is read.
> - Preserve tenant isolation: all reads tenant-scoped; a foreign sale id returns null, including through the three added `select` fields.
> - Preserve authorization: `canSell` and `resolvePosContext` unchanged.
> - Preserve idempotency: one `idempotencyKey` per cart, regenerated only in `startNewSale()`. Closing the modal must not regenerate it. A duplicate submission still yields exactly one sale and shows the duplicate notice.
> - Do not touch `createSale`, `SaleSummary`, `POST /api/v1/sales`, `schema.prisma`, `PrintButton.tsx`, `/sales`, `/sales/[id]`, or `sales.test.ts`.
>
> **Verify before claiming done:**
> - Browser: complete a real sale; read the modal at 1536, 1280, 900, 390. At 900 and 390 confirm the modal covers the workspace and is not clipped by the parent's `overflow-y-auto`, **including after the workspace has been scrolled** — flagged unverified in §4.
> - Database: bill number, subtotal, discount, tax, total, paid, every payment row and every item row match the `Sale`, `SaleItem` and `SalePayment` rows. `erpSyncStatus` is `PENDING` and the UI says pending.
> - **Absence gates:** no invoice number, no seller GSTIN (unless approved), no sales person, and no PDF / WhatsApp / Email / Return-Exchange control anywhere in the DOM.
> - `/sales`: the sale appears with the same bill number and total.
> - `/sales/{id}`: `View Bill Details` resolves; every figure matches the modal.
> - `/inventory`: the sold variant's `StockLevel` decremented by the sold quantity; the modal makes no claim about global stock.
> - Idempotency: double-submit yields one sale, HTTP 200, `duplicate: true`, duplicate notice shown. Closing and reopening does not create a second sale.
> - Tenant isolation: a second tenant cannot read the sale through the new read path.
> - Accessibility: real `role="dialog"` with `aria-modal` and an accessible name; focus moves in, is trapped, and returns on close; `Escape` closes with the same semantics as `×`; receipt preview is a real `<table>`; every action keyboard-reachable with a visible focus ring; duplicate notice announced.
> - Print: preview shows the receipt column only.
> - Gates: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:integration`, `npm run build` — all green. Confirm script names against `apps/web/package.json` first.
> - Regression: F9 payment behaviour, `startNewSale()`, cart, catalogue, and the **F8 POS geometry gates** — the latter are genuinely at risk now that the workspace stays mounted during success, so run them.
>
> **Report:** what shipped, what was omitted and the evidence for each omission, every gate's result, screenshots at all four widths, and the database correlation evidence.
>
> **Then stop.** Do not start screen 21 or any other screen.

---

## 14. Open Questions for the Owner

These are blocking — each decides whether something ships at all. Answer before step 2 of §8.

1. **The seven unsupported controls (§2.3).** The reference shows Invoice No., seller GSTIN, Sales Person, Download PDF, WhatsApp, Email and Return/Exchange. None has a backend. The audit's recommendation is to omit all seven and ship Print alone, matching the ruling already recorded in `PrintButton.tsx`. **Confirm, or name which ones justify building their backend first.** The invoice number is not negotiable on the audit's side — it is a tax-document risk, not a feature gap.
2. **Change due.** The reference does not show it; its example split settles exactly. For a cash sale, change is the number the cashier physically acts on, and the data is already present. **Add it, or deliberately omit it?**
3. **Seller GSTIN.** No store-level field exists. Options: use `Tenant.taxId` (tenant-wide, nullable), add a store-level field in a later slice, or omit. A receipt showing GST but no seller GSTIN may not satisfy Indian invoicing expectations — worth a compliance check beyond this audit.
4. **Barcode.** Needs a new dependency. Is a scannable bill number on the receipt a real operational requirement, or decorative in the mock?
5. **Keyboard shortcuts (F2/F3).** Genuinely useful at a till, but F3 collides with browser find-in-page. Ship them, pick different keys, or defer?
6. **Item discount.** The reference shows one `Item Discount` row. Is that `Sale.discountMinor` (order-level) or the sum of `SaleItem.lineDiscountMinor`? They are different numbers.
7. **Size/colour on receipt lines.** `SaleItem` does not snapshot them, so they must be joined live and a later variant edit would retroactively change a past receipt. Accept the live join, or add snapshot columns in a later slice?

---

## 15. Git Integrity

**Files created by this audit:** `F10-SALE-SUCCESS-DESIGN-AUDIT.md` (this file) only.

**Application source modified by this audit: NONE.** No edits to `PosTerminal.tsx`, `sales.test.ts`, payment logic, `schema.prisma`, or any production screen. No migrations. No commits. No destructive or reseeding database commands.

**Two working-tree changes occurred during the audit window that this audit did not make,** recorded so they are not mistaken for its output:

1. `SCREENS/phase-2-screens/ChatGPT Image Oct 3, 2026, 11_26_53 AM.png` — added 11:26, the reference image this document is built around.
2. `apps/web/next-env.d.ts` — modified. The diff is two import paths moving from `./.next/types/…` to `./.next/dev/types/…`. This file is generated by Next.js and carries the comment "This file should not be edited". The change is consistent with a Next.js dev server or build running in the concurrent F9 session; no tool in this audit wrote to it.

**No sale was created during this audit.** Completing a test sale would write `Sale`, `SaleItem`, `SalePayment`, `StockLevel` and outbox rows while F9's verification gate is running in another session, and could corrupt that gate's evidence. The frontend trace in §4 is therefore read from source, not observed at runtime — stated plainly rather than presented as live behaviour. The live-behaviour checks are instead written into §9 as F10's own gates.

The working tree already contained F9's in-progress modifications and a large number of pre-existing untracked development scripts and screenshots. Those were left exactly as found.
