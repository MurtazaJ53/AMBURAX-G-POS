# AMBURAX G-POS: Open questions

**For:** the owner (Murtaza), with finance, the GST reviewer and the ERPNext administrator where named.
**Updated:** 15 Oct 2026.

This is the single list of everything still undecided. It replaces the scattered question lists in latter.md, which stays as the history log. Answer by number: write your answer after the arrow (→). My suggestion is in [brackets]. When a question is answered, I record the decision here and in latter.md and build it.

---

## A. Blocking the demo business's ERPNext sync (do these first)

Full details and fill-in tables are in [DECISION_PACKET_2026-10-15.md](DECISION_PACKET_2026-10-15.md).

| # | Question | Who decides | Suggestion |
|---|---|---|---|
| A1 | Which ERPNext company does the demo business use? | ERPNext administrator | [The synthetic INR/India company, demo data only; never convert the USD "Amburax Retail"] → |
| A2 | Opening stock for the 14 demo products: quantity before the 16 sales, cost with evidence, physical count for the 2 oversold items | Finance | [Products without an evidenced cost stay blocked] → |
| A3 | GST classification of the Men's Oxford Shirt (HSN, rate, effective date) | GST reviewer | [Collect material and supplier evidence first] → |
| A4 | Deactivate test product QA-VAR-1791284136371? It has 3 purchase orders and receipts that were synced to ERPNext. | Owner | [Yes, it's test data. The records are kept.] → |

## B. Tax and GST

| # | Question | Suggestion |
|---|---|---|
| B1 | Has your CA confirmed the garment GST slab: 5% up to ₹2,500 per piece (compared before GST), 18% above? | [Yes / change it] → |
| B2 | Switch all existing garment products to "Garment slab" at once, or one by one? | [All garments now] → |
| B3 | Do you sell anything exempt, 0% or nil-rated? (Blocked at the till for GST-registered businesses today.) | [No; keep blocked] → **Answered 2026-10-16: Yes, allowed.** Exempt, nil-rated, zero-rated and non-GST lines sell at 0 tax beside taxable ones. Turning GST on later sends "no GST" products to *Set GST type* before they sell (option A). |
| B4 | Create 5% and 18% tax templates in ERPNext (via India Compliance) and map them? | [Yes] → |
| B5 | Receipt / tax invoice layout (screen 75): which fields must a GST invoice show? | [Your CA lists them; Rule 46] → |

## C. Credit (udhar) and customers

| # | Question | Suggestion |
|---|---|---|
| C1 | Cashiers see customers' full phone numbers, or masked (98XXXXXX10)? | [Masked for cashiers] → |
| C2 | Top customers: rank by spend or by visits, over what period? | [Spend, last 90 days] → |
| C3 | Customer groups: only the 3 built-in types, or your own groups too? | [Types only] → |
| C4 | Loyalty: has finance and the GST reviewer approved the tax treatment of points? (Loyalty is built but switched off until then.) | [Not yet] → |

## D. Sales and the till

| # | Question | Suggestion |
|---|---|---|
| D1 | Cancel a bill: same day only, by a manager with PIN? | [Yes] → |
| D2 | Exchanges: return plus new bill in one step, difference paid or refunded? | [Yes] → |
| D3 | POS "Quick add": a grid of best-selling items at the till? | [Yes, top 12] → |
| D4 | Separate "Barcode scan" tab, or is the search box (which already scans) enough? | [Search box is enough] → |
| D5 | Offers and pricing rules (screens 56–58): which offer types; do they stack with manual discounts; how does GST apply to them? | [ERPNext Pricing Rule as master; % off, flat off, buy-X-get-Y; no stacking] → |

## E. Stock and reports

| # | Question | Suggestion |
|---|---|---|
| E1 | "Dead stock": items unsold for how many days? | [90 days] → |
| E2 | Should Reports show profit after customer returns? | [Yes] → |
| E3 | Supplier payments and debit notes: in ERPNext only? | [Yes; ERPNext owns them] → |
| E4 | Stock transfers: does someone need to approve a transfer before it is sent? If so, who, and above what value? | [No approval under ₹50,000; store manager above] → |

## F. People and access

| # | Question | Suggestion |
|---|---|---|
| F1 | Roles (screen 67): only the fixed roles, or custom roles you define? | [Fixed roles only] → |
| F2 | Suppliers and leads: only the owner or a store manager can change them; all staff can view. Keep this? | [Keep] → |
| F3 | Reports: only the owner and store managers can see them. Keep this? | [Keep] → |
| F4 | Changing a staff member's role or removing them from a store: build it now? | [Yes] → |

## G. Hosting, accounts and providers

| # | Question | Suggestion |
|---|---|---|
| G1 | Where does the AMBURAX app run (ERPNext goes on Frappe Cloud)? | [A VPS in India, for example DigitalOcean Bangalore or AWS Mumbai] → |
| G2 | Product photos: server disk or cloud storage? | [Cloud storage: S3 or Cloudflare R2] → |
| G3 | Daily automatic backups of both databases, plus a tested restore every month? | [Yes] → |
| G4 | SMS and email provider, needed for real OTPs, two-step sign-in, sign-in alerts and notifications (screen 76) | [MSG91 for SMS, Amazon SES for email] → |
| G5 | Frappe Cloud: create the account and paid plan, and approve a team API key so AMBURAX can create a site for every new business | [Yes; I present the key's exact purpose for approval first] → |
| G6 | AI screens (62–66): which AI provider, and what data may leave the system? | [Decide later] → |
| G7 | Wait for ERPNext to confirm an invoice before the receipt prints, or print a provisional receipt and confirm later? | [Provisional, confirm later] → |

## H. Technical clean-up (small)

| # | Question | Suggestion |
|---|---|---|
| H1 | Delete the 3 old rows in the dev table `khata_payments_legacy`? | [Delete] → |
| H2 | Delete the dev photos in `public/uploads`? | [Delete] → |
| H3 | Clean the hardcoded fallback ERPNext key and secret out of `apps/web/scripts/verify_sales.ts`? (It touches credential material, so it needs your OK.) | [Yes] → |
| H4 | HRMS (payroll and leave in ERPNext): it's planned for the very end. Confirm it stays last. | [Yes] → |

---

## Already decided (for reference; full text in latter.md)

36 reservations · 41 loyalty (built, off) · Q5–Q10 credit · E4–E8 till, attendance, pay-outs, returns, ERPNext v16 · A: ERPNext first · purchase cost excluding GST · discounts (10% cashier, PIN above) · the ERPNext company is created automatically per business · non-GST businesses sell at 0% · Frappe Cloud for ERPNext · HRMS last.
