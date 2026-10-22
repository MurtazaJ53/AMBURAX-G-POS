# AMBURAX G-POS: Decision packet, 15 Oct 2026

**For:** Finance, the authorised GST reviewer and the ERPNext administrator.
**Scope:** the demo tenant "Demo Retail Co." on the **development** ERPNext site `frontend` only. Nothing here touches production.
**Why now:** 16 demo sales cannot reach ERPNext, and 2 returns and 1 stock movement are waiting behind them. These three decisions are prerequisites. They are taken in this order: Company first, because opening stock is posted into that Company's books.

Each decision needs: who decided, the evidence, and the approval status. GST approval is recorded separately from product and engineering approval. Until a row is approved, the AMBURAX sync for it stays blocked, and nothing is posted to ERPNext.

---

## 1. ERPNext administrator: which Company is the demo tenant's?

The demo store "Main Store" (MAIN, Karnataka) is mapped to ERPNext warehouse **Stores - AR**. In AMBURAX, the store is **not linked to any Company**.

| ERPNext Company | Abbr | Currency | Country | Store warehouse | Cash | Stock adjustment | Inventory |
|---|---|---|---|---|---|---|---|
| Amburax Retail | AR | **USD** | **United States** | Stores - AR | Cash - AR | Stock Adjustment - AR | Stock In Hand - AR |
| AMBURAX GST TEST — SYNTHETIC | AGTS | INR | India | Stores - AGTS | Cash - AGTS | Stock Adjustment - AGTS | Stock In Hand - AGTS |

**Problem found:** the warehouse the store uses today belongs to a company set up in **US dollars, in the United States**. An Indian store billing in rupees with GST should not post into that company's books. The only INR / India company is named "SYNTHETIC" and was made for GST tests.

**What the administrator must decide (do not choose by name):**
- Option A: correct "Amburax Retail" to INR / India. This is only possible if it has no transactions yet; ERPNext locks the currency after the first posting. Then keep Stores - AR.
- Option B: create a new INR / India company for the demo tenant, with its own store warehouse and accounts, then remap the store.
- Option C: use "AMBURAX GST TEST — SYNTHETIC" and remap the store to Stores - AGTS.

| Decision | Company | Currency | Warehouse | Accounts | Decided by | Evidence | Status |
|---|---|---|---|---|---|---|---|
| | | | | | | | Pending |

## 2. Finance: opening stock valuation

These are the SKUs on the blocked sales, with the stock AMBURAX holds for them in Main Store. **No SKU has a cost recorded in AMBURAX.** The demo stock was entered directly, not through priced purchase receipts. Under the rule (an approved cost basis, never the selling price), **every one of them stays blocked** until finance supplies a cost with evidence.

| SKU | Product | AMBURAX qty | AMBURAX cost | Selling price (for reference only, not a cost) | Unit value (finance) | Source / evidence | Effective date | Warehouse | Status |
|---|---|---|---|---|---|---|---|---|---|
| CHINO-BEG-30 | Chinos | **−12** | none | ₹1,499.00 | | | | (per §1) | Blocked: oversold, see note |
| CHINO-BEG-32 | Chinos | 12 | none | ₹1,499.00 | | | | | Blocked: no cost |
| CHINO-GRY-32 | Chinos | 33 | none | ₹1,499.00 | | | | | Blocked: no cost |
| SHIRT-WHT-M | Cotton Formal Shirt | 16 | none | ₹1,299.00 | | | | | Blocked: no cost |
| CAP-NVY-FS | Cap | **−4** | none | ₹499.00 | | | | | Blocked: oversold, see note |
| CAP-BLK-FS | Cap | 28 | none | ₹499.00 | | | | | Blocked: no cost |
| CTB-001 | Canvas Tote Bag | 35 | none | ₹699.00 | | | | | Blocked: no cost |
| CTB-002 | Canvas Tote Bag | 10 | none | ₹699.00 | | | | | Blocked: no cost |
| TOTE-NAT-FS | Canvas Tote Bag | 33 | none | ₹499.00 | | | | | Blocked: no cost |
| CMD-001 | Cotton Maxi Dress | 17 | none | ₹2,499.00 | | | | | Blocked: no cost |
| KDO-001 | Kids Denim Overalls | 13 | none | ₹1,299.00 | | | | | Blocked: no cost |
| JACK-NVY-L | Jacket | 12 | none | ₹2,499.00 | | | | | Blocked: no cost |
| COS-001 | Corduroy Overshirt | 8 | none | ₹2,499.00 | | | | | Blocked: no cost |
| CCB-001 | Casual Crossbody Bag | 5 | none | ₹1,499.00 | | | | | Blocked: no cost |

**Notes for finance**
- **Opening quantity is not simply today's AMBURAX quantity.** The opening stock must be the quantity **before** the 16 blocked sales, so that those sales then reduce it. The quantities above are after the sales. Finance should approve the opening quantity as of the effective date, and engineering will reconcile it against the sales in between.
- **Two SKUs are below zero (oversold).** CHINO-BEG-30 is at −12 and CAP-NVY-FS is at −4. A physical count is needed before any opening figure can be approved.
- Evidence can be supplier invoices, purchase receipts or a costed stock-take. Where there is none, the SKU stays blocked and is listed here.

## 3. GST reviewer: unclassified products (statutory approval, separate)

Eleven variants have GST treatment **UNSPECIFIED**, not six as reported yesterday. Ten of them are **QA or test products**, not stock that is sold.

| SKU | Product | Category / brand | Price | Suggested action | HSN | Rate | Effective date | Evidence | Reviewer | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| AMB-SH-001-S | Men's Classic Oxford Shirt (S, Sky Blue) | Shirts / Amburax Basics | ₹1,000.00 | Classify: needs material/construction and supplier evidence | | | | | | Pending |
| 11 | SAMS-HONEY (size "121", colour "121") | MOBILE / POCO | ₹555.00 | Looks like test data: confirm, then deactivate | | | | | | Pending |
| 2222 | SAMS-HONEY (size "223", colour "23") | MOBILE / POCO | ₹1,11,111.00 | Looks like test data: confirm, then deactivate | | | | | | Pending |
| QA-VAR-1791284136371 | QA Product | — | ₹150.00 | Test data: deactivate | n/a | n/a | | | | Pending |
| QA-VAR-1791284186610 | QA Product | — | ₹150.00 | Test data: deactivate | n/a | n/a | | | | Pending |
| QA-VAR-1791286868437 | QA Product | — | ₹150.00 | Test data: deactivate | n/a | n/a | | | | Pending |
| QA-VAR-1791286911683 | QA Product | — | ₹150.00 | Test data: deactivate | n/a | n/a | | | | Pending |
| SKU-1791296483871 | Test Product | E2E Testing | ₹99.99 | Test data: deactivate | n/a | n/a | | | | Pending |
| SKU-V2-1791296495335 | Test Product | E2E Testing | ₹99.99 | Test data: deactivate | n/a | n/a | | | | Pending |
| SKU-1791296599867 | Test Product | E2E Testing | ₹99.99 | Test data: deactivate | n/a | n/a | | | | Pending |
| SKU-V2-1791296606537 | Test Product | E2E Testing | ₹99.99 | Test data: deactivate | n/a | n/a | | | | Pending |

Deactivating a test product is a **product** decision, not a GST one. It needs the owner's approval, and AMBURAX keeps the record; nothing is deleted. Only the Oxford shirt needs a GST classification from the reviewer.

---

## After all three are approved (engineering, in this order)
1. Link the demo store to the approved Company and warehouse in AMBURAX.
2. Post opening stock to ERPNext only for the approved SKUs (a Stock Reconciliation of type "Opening Stock"), then confirm the stock is present in ERPNext.
3. Start `npm run outbox:work`, and let the blocked sales retry through the normal idempotent outbox. Check each resulting Sales Invoice in ERPNext.
4. Only then let the 2 returns and 1 stock movement proceed.

Rules that hold throughout: negative stock stays off in ERPNext; no pending event is deleted or marked successful to clear the queue; production readiness needs the full accounting and inventory flow verified from end to end.

---

## Decision log

| Date | Item | Decision | Owner | Evidence | Approval status |
|---|---|---|---|---|---|
| 15 Oct 2026 | §1 Company | **Recommended:** use "AMBURAX GST TEST — SYNTHETIC" (INR / India) for demo-only data, *once the ERPNext administrator confirms it is still suitable and isolated*. Do **not** convert "Amburax Retail" to INR to unblock sync. A real Indian business needs its own properly configured Company for the actual legal entity, not the synthetic one. | Owner (recommendation) / ERPNext admin (decision) | Read on 15 Oct: SYNTHETIC has 0 GL, 0 stock-ledger, 0 sales invoices, 0 purchase docs. Amburax Retail has 252 GL entries and 43 sales invoices (34 submitted) in USD, so converting it is unsafe. | **Pending administrator confirmation** |
| 15 Oct 2026 | §2 Opening stock | All 14 SKUs stay blocked until finance gives an evidenced unit cost. CHINO-BEG-30 (−12) and CAP-NVY-FS (−4) need a physical count and reconciliation; no positive quantity is invented. Finance provides the quantities as they were *before* the 16 sales. After posting and verifying, the sales are retried exactly once through the idempotent outbox. | Owner / Finance | — | **Pending finance** |
| 15 Oct 2026 | §3 Test products | Deactivate confirmed QA/test products; keep records, IDs, history and audit. **Done for 9**, each checked to have no references in any table (sales, orders, receipts, stock, movements). Done through the catalog service (audited, correlation `owner-2026-10-15-deactivate-test-products`). | Owner (product decision) | Reference check across every table with a `variantId` column | **Done (9)** |
| 15 Oct 2026 | §3 QA-VAR-1791284136371 | **Not deactivated.** It is referenced by 3 purchase orders, 3 purchase receipts, replenishment lines, stock and 3 stock movements, which were synced to ERPNext during the live purchasing check. Needs the owner's call on whether those count as test transactions. | Owner | Reference check | **Pending owner** |
| 15 Oct 2026 | §3 Men's Oxford Shirt | Stays blocked from tax sync until the GST reviewer confirms classification, rate and effective date. | GST reviewer (statutory) | Material/construction and supplier evidence still to be collected | **Pending GST reviewer** |

Note: deactivating the 9 queued 9 routine "product updated" sync events. With the worker stopped they wait in the queue; when it runs, they will be refused as unclassified, by design.
