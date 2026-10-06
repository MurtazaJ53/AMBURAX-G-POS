# F13 — Held / Parked Bills: Discovery & Design Audit

**Status:** Read-only discovery. No source was modified by this audit.
**Audit date:** 2026-10-03
**HEAD at audit time:** `f168aca` (branch `main`)
**Blocked on:** integration infrastructure repair, then F12's formal GREEN. **F13 implementation must not begin before both.**

---

## 1. Exact Screen

| Field | Value |
|---|---|
| Screen name | Held / Parked Bills |
| Roadmap number | 21 |
| Roadmap source | `AMBURAX_POS_FINAL_ALL_MD_v8 (1)/SCREEN_MAP.md:26` |
| Phase scope source | `AMBURAX_POS_FINAL_ALL_MD_v8 (1)/PHASES.md:16` — "…split payment, Khata sale, **held bills**, history, bill details." |
| Primary route | `/pos` — **no new route required** |
| Design type | In-`/pos` panel or modal over the existing shell, following the F10 precedent |

**Purpose.** Let a cashier set a part-built cart aside and serve someone else, then bring it back — the queue-jumping problem every counter has (customer forgot their wallet, needs a size from the stockroom, a second customer has one item). Nothing is sold, nothing is paid, no stock moves, no bill number is issued.

**Entry points — both already exist in the UI, correctly stubbed as disabled:**

```
apps/web/src/app/(app)/pos/PosTerminal.tsx:585
  <ActionBtn label="Hold Bill"     hotkey="(F3)" disabled />
apps/web/src/app/(app)/pos/PosTerminal.tsx:586
  <ActionBtn label="Retrieve Bill" hotkey="(F4)" disabled />
```

These sit in the POS "Quick Actions" footer and are `disabled` — present in the design, honestly inert because nothing backs them. F13's job is to make exactly these two real.

**Exit flow.**

```
Hold:     cart (non-empty) -> hold -> cart cleared -> till ready for next customer
Retrieve: Retrieve Bill -> list of this store's held bills -> pick one
          -> cart replaced -> held bill consumed -> normal F9 checkout -> F10 success
Discard:  list -> delete -> held bill gone, nothing else touched
Expire:   untouched past its TTL -> no longer offered for resume
```

**The invariant this whole screen hangs on:** a held bill is **not** a sale. It must never appear in `/sales`, never move stock, never consume a bill number, never emit an outbox event, and never be counted in dashboard revenue. §4 and §5 are about making that structurally impossible rather than merely intended.

---

## 2. Reference Anatomy

### 2.1 No approved visual reference exists

Searched exhaustively:

| Search | Result |
|---|---|
| `SCREENS/phase-1-screens/` | A1–A14 auth/onboarding + worker. Nothing. |
| `SCREENS/phase-2-screens/` | `Dashboard`, `bill details`, `catloag`, `customer(CRM)`, `customer-due`, `inventory`, `pos-checkout`, `sales`, and the F10 sale-success image. **No held/parked bills screen.** |
| `grep -ri "held\|parked\|park"` across all 51 reference `.md` files | Two hits only: `SCREEN_MAP.md:26` (roadmap line) and `PHASES.md:16` (phase scope). No specification, no wireframe, no state matrix, no API matrix entry. |
| `.user_uploaded/` | Does not exist. |
| New images since 2026-10-01 | Only the F10 reference. |
| Repository code | `PosTerminal.tsx:585-586` — the two disabled buttons. No other implementation anywhere. |

**The only visual artifact is the pair of disabled buttons** and their presence in `SCREENS/phase-2-screens/pos-checkout.png`'s Quick Actions row. That establishes placement, labels and hotkeys — nothing about the list itself.

**Consequence:** F13 either waits for a reference, or the owner accepts a design derived from the existing POS design language. This audit does not invent one; §2.2 sets out what the *data* can support, so that whoever designs it knows the real material.

### 2.2 Anatomy, as a capability checklist rather than a drawing

What a held-bills list could truthfully show, given the data a hold would capture. Each row is "can this be real", not "does the reference show it".

| Element | Can it be real? | Source if built |
|---|---|---|
| Title / header | Yes | Static |
| Held-bill list | Yes | New model, §5 |
| Row: customer | Yes, conditional | `customerId` → `Customer.name`, null for walk-in |
| Row: amount | Yes | Server-recomputed at hold time, or recomputed on display — **see the pricing warning below** |
| Row: item count | Yes | Sum of held line quantities |
| Row: time held | Yes | `createdAt`, rendered with the existing `formatDateTime` |
| Row: cashier | Yes | `cashierUserId` → `User.name` |
| Row: terminal / session | **Partial** | `PosSession` exists and carries `posDeviceId`; but `Sale.posSessionId` is already nullable because a back-office sale has no till, and in the current demo data it is **null** (no shift open). A terminal column would be blank in exactly the situation the dev environment runs in. |
| Search | Yes | Over customer name / cashier / note, server-side, tenant+store scoped |
| Filters (mine / this terminal / all) | Yes | Needs the ownership decision in §6 first |
| Resume action | Yes | §7 defines the safe form |
| Delete / cancel action | Yes | Soft-delete by timestamp, per the codebase's derived-state convention |
| Detail / preview of lines | Yes | Held line items |
| Keyboard shortcuts F3 / F4 | **Partial** | The labels already exist. No keyboard shortcut system exists anywhere in `/pos`; F10 deliberately deferred F2/F3 for the same reason. F3 is browser find-in-page. Shipping the labels without the handlers leaves two printed promises unkept — they are already printed today. |
| Empty state | Yes | Required — the common case |
| Responsive | Yes | §9 |

**Pricing warning that must be settled before any UI is drawn.** A held cart's money is stale by definition: prices can change between hold and resume. There are two honest options and they look different on screen —

- **Recompute on resume** (recommended): the held bill stores variant ids and quantities; prices are re-read when it is resumed, exactly as `createSale` already does (every figure server-calculated from the variant's stored price, never from the browser). The list then shows an *indicative* amount that may differ on resume, and must be labelled as such.
- **Snapshot at hold**: store prices with the hold. Then a resumed bill can charge a price the catalogue no longer offers, and the cashier is not told. This conflicts with how `createSale` is built.

The recommendation is recompute-on-resume. It is also the only option that keeps `createSale` untouched.

---

## 3. Current Backend Capability

Classification: **REAL** = exists and is authoritative today · **PARTIAL** = something related exists but does not cover this · **MISSING** = no implementation.

| Capability | Class | Evidence |
|---|---|---|
| Parked / held bill model | **MISSING** | No model in `schema.prisma` (32 models; none named or shaped for this). |
| Draft sale model | **MISSING** | `enum SaleStatus { COMPLETED, VOIDED }` (`schema.prisma:1043-1046`). There is **no DRAFT**. A `Sale` row cannot represent an unfinished bill. |
| Temporary cart persistence | **MISSING** | The cart is React state only — `const [cart, setCart] = useState<CartLine[]>([])` (`PosTerminal.tsx:153`). No `localStorage`, no `sessionStorage`, no IndexedDB anywhere in the file. A refresh loses the cart today. |
| Cart recovery | **MISSING** | Follows from the above. |
| Customer association | **PARTIAL** | `Customer` exists and `Sale.customerId` is composite-keyed to the tenant. The pattern to copy exists; nothing holds it for an unfinished cart. |
| Store association | **PARTIAL** | `Store` and the composite `(storeId, tenantId)` FK pattern are established throughout. Same: pattern yes, holder no. |
| Terminal association | **PARTIAL** | `PosDevice` and `PosSession` exist (`schema.prisma:246`, `1603`). `Sale.posSessionId` is **nullable** and is null in practice when no shift is open — verified during F10. So terminal identity is available but not guaranteed. |
| Cashier association | **PARTIAL** | `Sale.cashierUserId` with a composite FK is the established shape. |
| Expiry | **MISSING for carts**, **REAL as a pattern** | `expiresAt` is used by `OnboardingSession`, `Invitation`, `PasswordResetToken`, `MfaChallenge`, `Session` (`schema.prisma:137, 417, 444, 493, 519`). A well-worn precedent to copy. |
| Ownership | **MISSING** | No concept of "whose held bill". §6. |
| Locking | **MISSING for carts**, **REAL as a pattern** | `Order.version Int @default(1)` (`schema.prisma:1392`) with the documented contract: *"Every transition reads this and writes `version + 1` conditionally, so two clients confirming the same order at once cannot both succeed."* Exactly the mechanism F13 needs. |
| Multi-device behaviour | **MISSING** | Nothing coordinates two tills. |
| Idempotency | **PARTIAL** | `Sale.idempotencyKey` with `@@unique([tenantId, idempotencyKey])` and `Order.idempotencyKey` both exist and work. The pattern transfers; no held-bill equivalent exists. |
| API surface | **MISSING** | No route under `apps/web/src/app/api/` matching draft/held/park/cart. |

**Summary: the backend for this screen does not exist at all.** Every *pattern* F13 needs — composite tenant FKs, `expiresAt`, optimistic `version`, `idempotencyKey`, derived state via nullable timestamps — is already established and battle-tested elsewhere in this schema. That is the good news: F13 is a new model assembled from proven parts, not new architecture.

---

## 4. Current POS State Trace

```
[1] Catalogue tile click
    addToCart(hit)                       PosTerminal.tsx:244
    -> setCart([...])                    client state only, nothing persisted

[2] Cart
    const [cart, setCart] = useState<CartLine[]>([])      :153
    CartLine = { variantId, quantity, productName, sku, size, colour, imageUrl,
                 stockQuantity, + PricedLine }
    Totals computed client-side by computeSaleTotals for DISPLAY only.

[3] Customer / payment method / amounts
    all client state: customer, method, reference, amountReceived, splitPayments

[4] Complete Sale                        completeSale()
    POST /api/v1/sales with { idempotencyKey, lines[{variantId, quantity}],
                              customerId, payment|payments }
    NOTE: the browser sends variant ids and quantities. It does NOT send prices.

[5] Server                               saleService.createSale()
    requireCapability(RETAIL)                            :171
    canSell / role check                                 :195
    tx: store.update nextBillSeq++ -> billNumber         :305-310
        sale.create (status COMPLETED by default)        :312
        saleItem.createMany (price snapshots)
        salePayment.create (status CONFIRMED)            :329
        applyStockMovement  -> StockLevel + StockMovement
        enqueueOutboxEvent
```

### Where a held bill can safely live

**Not in step 5.** Everything after `createSale` is entered is irreversible-by-design: it burns a bill number from `Store.nextBillSeq`, writes `SaleItem` price snapshots, confirms payments, moves stock and emits an event. A held bill must enter **none** of that.

**The safe seam is between [3] and [4]** — a new, parallel server path that persists what the cart *is* (variant ids, quantities, customer, who/where) without touching anything `createSale` owns:

```
POST   /api/v1/pos/held-bills             hold   (cart -> row; cart cleared)
GET    /api/v1/pos/held-bills             list   (tenant + store scoped)
POST   /api/v1/pos/held-bills/:id/resume  claim + return lines
DELETE /api/v1/pos/held-bills/:id         discard
```

Resume returns **variant ids and quantities**, which the client rehydrates into the cart. It does **not** return a priced cart and does **not** pre-authorise a sale. The cart then flows through the unchanged F9/F10 path, and prices are resolved by `createSale` exactly as they are for any other sale.

### Why this cannot become a fake completed Sale

Four independent reasons, which is the point — one would be a convention, four is a structure:

1. **`SaleStatus` has no DRAFT.** A held bill is not expressible as a `Sale` without a schema change (§5.1).
2. **Separate table.** `listSales`, `listSalesPage`, `getSalesSummary`, `getSalesAnalytics` and every dashboard aggregate read `sale`. A held bill in its own table is invisible to all of them by construction, not by a `WHERE` clause someone must remember.
3. **No bill number.** Held bills never touch `Store.nextBillSeq`. A number is allocated only inside `createSale`'s transaction.
4. **No side effects.** Holding writes one row (plus its lines). No `StockMovement`, no `StockLevel` change, no `SalePayment`, no outbox event.

---

## 5. Data Model

### 5.1 `Sale` must not be reused — and this is not a close call

Adding `DRAFT` to `SaleStatus` would silently corrupt the product. `Sale` queries across the codebase assume every row is a real sale: `listSales` and `listSalesPage` feed `/sales`; `getSalesSummary` sums `totalMinor`; `getSalesAnalytics` and the dashboard's `getTodayMetrics`, `getSalesTrend`, `getPaymentMix`, `getSalesBreakdown` all aggregate over `sale`. None filters by status today, because today it does not need to. Introducing `DRAFT` would put unfinished carts into revenue figures, the sales list and the trading-day trend, and the fix would be a status filter added to every one of those call sites — with the failure mode being silent wrong numbers whenever one is missed.

`Sale` also carries fields a held bill cannot honestly fill: `billNumber` (`@@unique([storeId, billNumber])`, allocated under a row lock), `paidMinor`, `subtotalMinor`/`taxMinor`/`totalMinor` (server-computed at sale time), `erpSyncStatus`, `completedAt`.

### 5.2 `Order` must not be reused either

`Order` has `status OrderStatus @default(DRAFT)` and the word DRAFT is exactly the trap the brief warns about. It is the wrong aggregate:

- **It is the commerce/online-order model.** `FLOWS.md` places it in the Online Order and B2B flows, not at the till.
- **It allocates a human-facing number.** `orderNumber`, `STORECODE-SO-000001`, from `Store.nextOrderSeq`, "the same discipline and the same row lock `billNumber` uses". A parked cart must burn no sequence.
- **It has no tax or discount.** Its own comment: *"There is no `totalMinor`, and that is not an omission. Tax and discount are deliberately out of scope for this phase."* A POS cart has tax.
- **It has no terminal or session.** No `posSessionId`, no `posDeviceId`.
- **Its DRAFT means something else.** `DRAFT → CONFIRMED → RESERVED → PARTIALLY_FULFILLED → FULFILLED → CLOSED` is a fulfilment lifecycle. A held bill has no fulfilment.

Reusing it would put counter carts into the order pipeline and the order number sequence.

### 5.3 Recommendation: two new models

Genuinely necessary — there is no existing table that can hold this truthfully. Both are assembled from patterns already in this schema.

```prisma
model HeldBill {
  id       String @id @default(cuid())
  tenantId String
  storeId  String

  // Who parked it, and from which till. The session is nullable for the same reason
  // Sale.posSessionId is: a till may legitimately have no open shift.
  cashierUserId String
  posSessionId  String?

  customerId String?

  // Optional free text: "waiting for size 32", "gone to the ATM".
  note String?

  // Indicative only. Recomputed on resume by createSale from live variant prices —
  // this figure exists so the list can be read at a glance, never to charge anyone.
  indicativeTotalMinor Int @default(0)

  // Derived state, not status columns — the convention PosSession, Invitation and
  // PosDevice already use. One source of truth per fact.
  resumedAt   DateTime?
  resumedById String?
  discardedAt DateTime?

  // TTL, following OnboardingSession / Invitation / Session.
  expiresAt DateTime

  // Optimistic concurrency, same contract as Order.version: every transition reads it
  // and writes version + 1 conditionally, so two tills cannot both win.
  version Int @default(1)

  // Same contract as Sale's and Order's: a double-click or a retry returns the
  // original hold instead of parking the cart twice.
  idempotencyKey String

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenant     Tenant         @relation(fields: [tenantId], references: [id])
  store      Store          @relation(fields: [storeId, tenantId], references: [id, tenantId])
  cashier    User           @relation(fields: [cashierUserId, tenantId], references: [id, tenantId])
  posSession PosSession?    @relation(fields: [posSessionId, tenantId], references: [id, tenantId])
  customer   Customer?      @relation(fields: [customerId, tenantId], references: [id, tenantId], onDelete: Restrict)
  items      HeldBillItem[]

  @@unique([tenantId, idempotencyKey])
  @@unique([id, tenantId])                       // referencable half, invariant I-4
  @@index([tenantId, storeId, createdAt])
  @@index([tenantId, storeId, expiresAt])
  @@map("held_bills")
}

model HeldBillItem {
  id         String @id @default(cuid())
  tenantId   String
  heldBillId String

  variantId String
  quantity  Int

  // Display-only, so the list and preview can render without a catalogue round-trip.
  // NOT snapshots in the SaleItem sense: nothing is charged from these. Price is
  // resolved at resume by createSale, from the variant's stored price.
  nameHint       String
  skuHint        String
  priceHintMinor Int

  heldBill HeldBill       @relation(fields: [heldBillId, tenantId], references: [id, tenantId], onDelete: Cascade)
  variant  ProductVariant @relation(fields: [variantId, tenantId], references: [id, tenantId])

  @@index([tenantId, heldBillId])
  @@map("held_bill_items")
}
```

**Deliberate omissions, each for a reason:** no `billNumber` (no sequence burned); no `subtotalMinor`/`taxMinor`/`totalMinor` (money is resolved at sale time, never parked); no `paidMinor` or payments (nothing has been paid); no `erpSyncStatus` (nothing to sync); no `status` enum (the three timestamps say everything, and cannot disagree with each other the way a flag beside a timestamp can).

**Naming note:** the fields are `*Hint`, not `*Snapshot`, on purpose. `SaleItem.skuSnapshot` means *this is what was charged*. These mean *this is what it looked like when parked*. Different words so no future reader confuses the two.

---

## 6. Tenant / Store / Terminal Isolation

| Boundary | Mechanism | Recommendation |
|---|---|---|
| Tenant | Composite FKs `(storeId, tenantId)`, `(cashierUserId, tenantId)`, `(customerId, tenantId)` — the shape every tenant-owned model in this schema already uses | **Mandatory.** PostgreSQL then refuses a cross-tenant row; it is not left to a `WHERE` clause. |
| Store | `storeId` required; every list and fetch scoped to the caller's resolved store | **Mandatory.** `resolvePosContext` already resolves the store server-side and accepts no client-supplied store id. |
| Cashier | `cashierUserId` recorded | Recorded always; see the visibility question below. |
| Terminal / device | `posSessionId` nullable → `PosSession.posDeviceId` | Record when a shift is open. **Do not** gate resume on it — a till with no open shift would be unable to resume its own holds, and that is the dev-environment default. |

**Can one user resume another store's held bill?** With the model above, no — and for the right reason. The list and the fetch both scope by the tenant and store that `resolvePosContext` resolved from the session cookie; the client never names a store. A held-bill id from another tenant must return the same 404 as one that never existed, exactly as `getSaleDetail` already does for sales.

**The open product question — who may resume whose hold?** Three defensible answers and they are not technical:

- **Store-wide (recommended).** Anyone who may sell in the store sees and resumes any of its holds. Matches how a counter actually works: the cashier who parked it may be on a break, and the customer is standing there now.
- **Cashier-owned.** Only the parker resumes. Safer-sounding, but strands carts the moment a shift changes.
- **Terminal-owned.** Worst of both: breaks whenever the till has no open session, which is the current default.

Recommend store-wide, with the cashier's name shown on each row so it is never anonymous. **This is the owner's call, not the audit's** — see §12.

**Authorization.** Reuse `canSell` / `SELLING_STORE_ROLES` (`sellingRoles.ts`) unchanged: if a user may not ring up a sale in this store, they may not park or resume one either. And reuse the RETAIL capability gate — `requireCapability(tenantId, Capability.RETAIL)` — with the same 404-not-403 convention `createSale` uses, so a disabled capability is not an oracle.

---

## 7. Concurrency

Every scenario below is a real counter situation, not a theoretical one.

| Scenario | Risk | Required behaviour |
|---|---|---|
| **Two tills open the same held bill** | Both cashiers rebuild the same cart; the customer is served twice or billed twice | Resume is a **claim**, not a read. A single conditional UPDATE (below). **Zero rows updated = the loser**, told plainly ("Another till already resumed this bill"). Lines are returned only when that update affected one row. |
| **Resume vs delete race** | One cashier resumes while another discards | The same single statement decides it. Discard carries the identical guard on `resumedAt IS NULL`. Exactly one of the two wins; the other is told which happened. |
| **Resume vs expiry race** | A bill expires in the instant it is being resumed | `expiresAt > now()` sits inside the same WHERE, evaluated by the database rather than by the application reading the clock first. |
| **Duplicate resume** (double-click, retry) | Two carts from one hold | The second attempt matches zero rows because `resumedAt` is now set. The UI must treat "already resumed **by me**, just now" as success and re-return the lines, rather than showing an error for the user's own double-click — `resumedById` is what distinguishes the two. |
| **Stale held bill** | A week-old cart resurfaces with wrong prices | TTL. Expired bills are excluded from the list. §8. |
| **Hold pressed twice** | Two identical parked carts | `idempotencyKey`, `@@unique([tenantId, idempotencyKey])` — the same contract `createSale` uses. The second call returns the original hold. |
| **Resumed cart abandoned** | The cart is gone from the list but never sold | Accepted, and worth stating: once resumed it is a live cart, and a live cart can always be abandoned — that is true of any cart. The held bill is consumed; the cashier can park it again. |

The claim statement:

```sql
UPDATE held_bills
   SET resumedAt = now(), resumedById = :user, version = version + 1
 WHERE id = :id AND tenantId = :tenant
   AND resumedAt IS NULL AND discardedAt IS NULL
   AND expiresAt > now() AND version = :version
```

**No pessimistic locking.** The `version` column plus a conditional UPDATE is how `Order` already does this, and the comment at `schema.prisma:1392` spells out the contract. Row locks held across a user's thinking time are not an option at a till.

---

## 8. Expiry

**Why a TTL at all:** a parked cart holds no stock and reserves nothing, so a stale one is not dangerous — it is *misleading*. A cart parked on Friday resurfacing on Monday at Friday's prices, against stock that has since sold, wastes the cashier's time at the worst possible moment.

**Recommendation:** TTL configured in `env.ts` beside the existing `SESSION_TTL_HOURS` and `ONBOARDING_SESSION_TTL_MINUTES`, defaulting to the trading day (12–24h). Not hardcoded.

**Expiry is read-side, not a sweeper.** Exclude `expiresAt <= now()` from every list and every resume. Do **not** build a background job to delete rows: it is one more moving part, and the codebase already treats expiry this way for `Invitation` and `PasswordResetToken` (the comment at `schema.prisma:396` shows the conditional-update idiom). Housekeeping deletion, if ever wanted, is a separate maintenance concern.

**No stock implication.** Parking reserves nothing. `StockLevel` is an operational projection, not a ledger (`schema.prisma:1182-1189`), and a held bill must not pretend to hold inventory.

---

## 9. Responsive

The list lives inside `/pos`, so it inherits the F8 geometry constraints that F10 also had to respect.

| Width | What to verify |
|---|---|
| **1536 × 1024** | List readable; rows show customer, amount, items, time, cashier; actions reachable; no horizontal scroll |
| **1280 × 1024** | Same; rows must not wrap mid-figure |
| **900 × 1024** | `/pos` has collapsed from `lg:flex-row` to `flex-col`. Verify the panel is not clipped by the workspace's `overflow-y-auto` |
| **390 × 844** | Rows stack; touch targets at least 44px; **heading and close control reachable without scrolling** |

**Two F10 lessons that apply directly and should not be re-learned:**

1. A centred flex child taller than its scrolling parent is **clipped at the top**. Use the outer-scroll / inner-`flex min-h-full items-center` pattern already in `SaleSuccess`.
2. `h-[calc(100vh-68px)]` and `lg:overflow-hidden` on the POS workspace are F8 geometry gates. A `fixed` overlay avoids disturbing them; anything in-flow risks introducing desktop page scroll. Run `qa-pos-geometry.cjs` regardless.

---

## 10. Work Breakdown

### Backend

1. Migration adding `HeldBill` + `HeldBillItem` (§5.3). **The only schema change F13 needs.**
2. `heldBillService.ts` — `holdBill`, `listHeldBills`, `resumeHeldBill`, `discardHeldBill`. Mirrors `saleService`'s shape: tenant-scoped, capability-gated, result-union return type (`{ status: "ok" | "forbidden" | "not_found" | "already_resumed" | "expired" | "capability_disabled" }`), no client-supplied tenant/store/user.
3. Routes under `apps/web/src/app/api/v1/pos/held-bills/`, following `api/v1/sales/route.ts` exactly: `correlationId` from header or `randomUUID`, zod parse at the edge, `resolvePosContext`, 404-not-403 for a disabled capability.
4. Env: held-bill TTL beside the existing TTLs.

### Frontend

5. Enable `Hold Bill (F3)` — disabled while the cart is empty.
6. Enable `Retrieve Bill (F4)` — opens the list; badge the count.
7. The list panel: rows, empty state, preview, resume, discard, search.
8. Cart rehydration on resume: replace the cart, set the customer, **rotate the idempotency key** (a resumed cart is a new sale attempt and must not collide with the parked one's key).
9. Conflict messaging: "Another till already resumed this bill", "This bill expired" — each distinct and plainly worded.

### Explicitly out of scope for F13

Keyboard shortcut handlers (F3/F4 labels already exist and are already unkept — fixing that is a `/pos`-wide interaction system, and F10 deferred the same thing for the same reason); offline hold; cross-store hold; converting a held bill to a quotation or an `Order`; held-bill analytics; a `/held-bills` route.

---

## 11. Test Plan

### Integration (`src/test-integration/`) — a new `heldBills.test.ts`

- Hold writes exactly one `HeldBill` + N `HeldBillItem`, and **zero** `Sale`, `SaleItem`, `SalePayment`, `StockMovement`, `StockLevel` change and outbox rows.
- Hold does **not** increment `Store.nextBillSeq`. Assert the counter before and after.
- Same `idempotencyKey` twice returns the original hold; still exactly one row.
- Resume returns lines and sets `resumedAt`/`resumedById`, bumping `version`.
- **Second resume of the same bill fails** — the central concurrency assertion.
- Concurrent resume: two calls, exactly one wins.
- Resume after discard fails; discard after resume fails.
- Expired bill is not listed and cannot be resumed.
- A second tenant cannot list, read, resume or discard the first tenant's held bill.
- A user without a selling role cannot hold or resume.
- Disabled RETAIL capability returns 404, not 403.
- **Held bills never appear in** `listSales`, `listSalesPage`, `getSalesSummary`, `getSalesAnalytics`, or any dashboard aggregate. Assert directly.

### Unit

- Service result-union coverage for every branch.
- TTL boundary arithmetic.

### Browser QA

Real session, real catalogue, from `/pos`: build a cart → Hold → cart clears → build a second cart → Retrieve → list shows the first → resume → cart rehydrates with correct variants, quantities and customer → complete the sale through the unchanged F9 path → F10 success screen shows a correct bill. Then: discard a held bill; attempt a double resume; let one expire. Four widths. Console and network clean. Verify the resumed sale behaves identically to a never-held sale.

### Database QA

For the exact browser-created held bill: `HeldBill` row with correct `tenantId`/`storeId`/`cashierUserId`; `HeldBillItem` rows matching the cart; `Store.nextBillSeq` **unchanged**; no `Sale` row; no `StockMovement`. After resume: `resumedAt` set, `version` incremented, and the resulting `Sale` carries a bill number allocated normally with correct stock movements.

### Static gates

`npm run test` · `npm run test:integration` · `npm run typecheck` · `npm run lint` · `npm run build` — all exit 0, with test counts recorded before and after.

### Cross-screen behaviour

| Screen | Expected |
|---|---|
| `/sales` | Held bills **absent**. A resumed-and-completed sale appears normally, indistinguishable from any other. |
| `/sales/{id}` | No change. |
| `/inventory` | **No stock movement at hold.** Movement only when the resumed cart is actually sold. |
| Dashboard | Held bills in **no** metric — not revenue, not bill count, not the trend, not the payment mix. |
| `/till` | Out of scope. Whether closing a shift should warn about outstanding holds is a good question for a later slice. |
| `/pos` | Hold Bill and Retrieve Bill become live; everything else unchanged. |

---

## 12. Open Questions for the Owner

Blocking — answer before implementation starts.

1. **No visual reference exists (§2.1).** Supply one, or approve a design derived from the existing POS language? This audit did not invent a layout.
2. **Resume ownership (§6).** Store-wide (recommended), cashier-owned, or terminal-owned? Changes the model's indexes and the list's filters.
3. **TTL length (§8).** Trading day, 24h, or configurable per tenant?
4. **Pricing on resume (§2.2).** Recompute from live prices (recommended, and the only option that leaves `createSale` untouched) or snapshot at hold? Changes what the list may truthfully show.
5. **Hold limit.** Cap per store or per cashier? Without one, a till can accumulate dozens and the list becomes unusable.
6. **F3/F4 keyboard handlers.** The labels are already printed on two disabled buttons. Ship the handlers in F13, or keep deferring as F10 did?

---

## 13. Implementation Prompt (use after integration infrastructure is repaired **and** F12 is GREEN)

> **AMBURAX F13 — Held / Parked Bills**
>
> **Preconditions, both required:** the integration-test infrastructure is repaired and `npm run test:integration` exits 0 on a clean checkout; and F12 has received formal GREEN. If either is unmet, stop and report. Also confirm §12's open questions have been answered — questions 1, 2 and 4 change what gets built.
>
> **Read first:** `F13-HELD-PARKED-BILLS-DESIGN-AUDIT.md`. It is the authoritative scope.
>
> **Screen:** Held / Parked Bills (roadmap screen 21, `SCREEN_MAP.md:26`).
> **Route:** `/pos`. **Create no new route, no new page file.** The list is a panel or modal inside the existing POS shell, following the F10 `SaleSuccess` precedent.
>
> **Visual reference:** use the one the owner supplied in answer to §12 Q1. If none was supplied, stop and ask — do not invent a layout.
>
> **Entry points already exist, disabled:** `PosTerminal.tsx:585` `Hold Bill (F3)` and `:586` `Retrieve Bill (F4)`. Make exactly these two real. Do not add new entry points.
>
> **Design system:** `docs/frontend/DESIGN-SYSTEM.md` — `slate-50` app background, `white` cards, `slate-900`/`slate-500` text, `blue-600` primary, `emerald` success, `amber` warning, `rounded-2xl`/`rounded-lg`, Inter. Preserve the AMBURAX shell; do not redesign the POS terminal.
>
> **THE INVARIANT — a held bill is never a sale.** It must not appear in `/sales`, must not move stock, must not consume `Store.nextBillSeq`, must not emit an outbox event, and must not reach any dashboard metric. Make this structural, not conventional:
> - **Do not add `DRAFT` to `SaleStatus`.** Every `Sale` aggregate in the codebase assumes rows are real sales and none filters by status; adding DRAFT would silently put parked carts into revenue.
> - **Do not reuse `Order`.** It is the commerce/online-order aggregate, it allocates `orderNumber` from `Store.nextOrderSeq`, it has no tax or discount and no terminal, and its `DRAFT` means a fulfilment stage. Its name is the only thing that fits.
> - Use the new `HeldBill` / `HeldBillItem` models in §5.3. That migration is the **only** schema change F13 may make.
>
> **Build, verifying each step before the next:**
> 1. Migration for `HeldBill` + `HeldBillItem` exactly as §5.3 specifies — composite tenant FKs, `expiresAt`, `version`, `idempotencyKey`, derived-state timestamps, no `billNumber`, no money totals beyond the indicative figure, no status enum.
> 2. `heldBillService.ts` mirroring `saleService`'s shape: result-union return type, `requireCapability(RETAIL)`, `canSell` check, everything resolved server-side from the session. **The client never supplies a tenant, store, user or price.**
> 3. Routes under `api/v1/pos/held-bills/`, following `api/v1/sales/route.ts`: correlation id, zod at the edge, `resolvePosContext`, 404-not-403 for a disabled capability, and the same 404 for another tenant's id as for one that never existed.
> 4. Enable `Hold Bill`, disabled while the cart is empty.
> 5. Enable `Retrieve Bill`; build the list with rows, empty state, preview, resume, discard and search.
> 6. Cart rehydration on resume — replace the cart, set the customer, and **rotate the idempotency key**, since a resumed cart is a new sale attempt.
> 7. Distinct, plainly worded conflict messages for already-resumed, discarded and expired.
>
> **Concurrency — implement exactly this, not a read-then-write:**
> ```sql
> UPDATE held_bills
>    SET resumedAt = now(), resumedById = :user, version = version + 1
>  WHERE id = :id AND tenantId = :tenant
>    AND resumedAt IS NULL AND discardedAt IS NULL
>    AND expiresAt > now() AND version = :version
> ```
> Zero rows updated means the caller lost; return lines only when exactly one row was updated. Discard carries the same guard. A user's own double-click (matching `resumedById`, just now) is success, not an error. No pessimistic locks — `Order.version` is the precedent.
>
> **Expiry:** read-side only. Exclude `expiresAt <= now()` from lists and resumes. No background sweeper. TTL in `env.ts` beside `SESSION_TTL_HOURS`.
>
> **Hard constraints:**
> - Do not touch `createSale`, `SaleSummary`, `POST /api/v1/sales`, the F9 payment contract or split semantics, `PrintButton.tsx`, `/sales`, `/sales/[id]`, or the F10 `SaleSuccess`.
> - Real data only — no fixtures, no mocks, no placeholder money in production paths.
> - Preserve tenant isolation, `canSell` authorization and the RETAIL capability gate.
> - Ship no control that does nothing. If the owner deferred F3/F4 handlers, leave the hotkey labels as they are rather than wiring half of them.
>
> **Verify before claiming done:**
> - Integration: hold writes one `HeldBill` + N items and **zero** `Sale`/`SaleItem`/`SalePayment`/`StockMovement`/outbox rows, and does **not** increment `Store.nextBillSeq` (assert the counter either side). Duplicate `idempotencyKey` returns the original. Second resume fails. Concurrent resume: exactly one winner. Resume-after-discard and discard-after-resume both fail. Expired bills are unlistable and unresumable. A second tenant cannot list, read, resume or discard. A non-selling role cannot hold or resume. Disabled RETAIL returns 404.
> - **Assert directly that held bills appear in none of** `listSales`, `listSalesPage`, `getSalesSummary`, `getSalesAnalytics` or any dashboard aggregate.
> - Browser: real sale from `/pos` — build cart, Hold, cart clears, build another, Retrieve, resume, verify variants/quantities/customer rehydrate, complete through the unchanged F9 path, confirm the F10 success screen and a correctly allocated bill number. Then discard one, double-resume one, expire one. All four widths (1536, 1280, 900, 390): no clipping, no horizontal overflow, heading and close reachable without scrolling at 390, no desktop page scroll.
> - Database: `HeldBill` and `HeldBillItem` rows correlate to the browser-created hold; `Store.nextBillSeq` unchanged; no `Sale`; no `StockMovement`. After resume: `resumedAt` set, `version` incremented, and the resulting `Sale` has a normally allocated bill number with correct stock movements.
> - Cross-screen: `/sales` shows the completed sale and no held bills; `/inventory` moves only on sale, never on hold; the dashboard counts no held bill.
> - Regression: F9 CASH / UPI / CARD / SPLIT / More unchanged; F10 success screen unchanged; F11 history and F12 bill details unchanged; `qa-pos-geometry.cjs` F8 gates still pass.
> - Accessibility: the list is a named dialog with focus moved in and trapped, Escape closes, every row action is keyboard-reachable with a visible focus ring, and the empty state is announced.
> - Gates: `npm run test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm run build` — all exit 0. Record Test Files, Tests, Failed, Skipped and exit code for each.
>
> **Report:** `F13-IMPLEMENTATION-REPORT.md`, distinguishing what shipped, what was deferred and why, browser evidence, DB correlation, cross-screen results, responsive results, accessibility, console/network, exact gate figures, and git state.
>
> **Then stop.** Do not start F14.

---

## 14. Git Integrity

**Files created by this audit:** `F13-HELD-PARKED-BILLS-DESIGN-AUDIT.md` only.

**Application source modified: NONE.** No edits to any `.ts`, `.tsx` or `.prisma` file. No migrations. No commits. No database writes of any kind — this audit ran no sale, no seed and no reset. F11 and F12 were not touched.

**Working tree at the start of this audit:** `apps/web/next-env.d.ts` (Next.js generated), `apps/web/test-integration.out` and `apps/web/test.out` already modified, plus the pre-existing untracked development scripts and screenshots.

**Working tree at the end of this audit:** the same three, **plus 18 files this audit did not write** — `apps/web/vitest.integration.config.ts` and 17 files under `apps/web/src/test-integration/`. The change is the integration-infrastructure repair the F13 preconditions depend on, happening concurrently in another session: per-file `await db.$disconnect()` calls are being removed from `afterAll` hooks and replaced with a single suite-wide `globalTeardown`, under this new comment in the config:

> *"Disconnect the shared Prisma client once, AFTER the entire suite finishes. Individual test files must NOT call `db.$disconnect()` in their afterAll hooks — doing so closes the pool while subsequent files still need it, causing hangs."*

That matches the reported symptom exactly and is plainly the right fix. **This audit neither made nor touched those edits, and did not revert them.** They are recorded here only so the diff is not later mistaken for F13 work. Everything else was left exactly as found.

**One observation worth recording, not a finding:** `F11` and `F12` implementation reports do not exist in the repository, though both features are committed (`1166fb1`, `06446bb`, `f168aca`). F8, F9 and F10 each have theirs. If the F-series reports are meant to be the audit trail, two are missing — raised for the owner's awareness, not acted on.
