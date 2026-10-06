# F13 — Held / Parked Bills: Design Decision

**Status:** Visual proposal awaiting product-owner approval. **Not implemented. No code, schema or database was touched.**
**Screen:** Held / Parked Bills (roadmap screen 21) · **Route:** `/pos`
**Date:** 2026-10-03
**Companion:** `F13-HELD-PARKED-BILLS-DESIGN-AUDIT.md` (backend readiness, concurrency, data model)

## Reference images

| File | What it shows |
|---|---|
| `F13-REFERENCE-desktop-1536x1024.png` | Desktop, populated list |
| `F13-REFERENCE-desktop-empty-1536x1024.png` | Desktop, empty state |
| `F13-REFERENCE-mobile-390x844.png` | Mobile, populated list |
| `F13-REFERENCE-mobile-empty-390x844.png` | Mobile, empty state |

All four are watermarked **"F13 DESIGN REFERENCE — PROPOSAL · placeholder content, not production data"**. Every name, amount and note in them is invented display content. They live at repo root rather than in `SCREENS/`, because that folder holds owner-approved references and these are not approved yet — move them there if and when they are.

---

## Chosen layout

A **centred modal over the dimmed POS workstation**, 780px wide, with a sticky header and footer and a scrolling list between them.

Top to bottom: title with a live count badge and close control · a one-line purpose statement · a blue information banner stating plainly that nothing here has been sold · search plus an "All holds / Mine" segmented filter · the list of held bills as bordered cards · a footer carrying the `F3` / `F4` key legend and the expiry note.

Each row reads left to right as **who → what → who held it → when → what to do**: a short `REF` chip, customer name (or "Walk-in") and the cashier's note; then Items, Amount, Cashier, Held-ago as four labelled facts; then `Resume` and `Discard`.

## Why it fits `/pos`

- **The workstation stays on screen.** The catalogue, cart and payment panel remain visible and recognisable behind a light dim, so the cashier never loses their place. This is the point of a modal rather than a route.
- **It follows the precedent F10 set.** The sale-success screen is already a centred modal over a dimmed `/pos`; reusing that pattern means one modal idiom in the terminal rather than two.
- **No new route.** `/pos` keeps a single URL. The audit's §1 and §5 both depend on this.
- **It respects the F8 geometry gates.** A `fixed` overlay disturbs neither `h-[calc(100vh-68px)]` nor `lg:overflow-hidden`, so no desktop page scroll is introduced.
- **It uses the existing design language unchanged** — `slate-50` ground, white cards, `slate-200` borders, `blue-600` primary, Inter, 11–13px dense type, `rounded-lg`/`rounded-xl`.

A right-hand drawer was considered and rejected: the cart panel already owns the right edge, and a drawer would either cover the cart the cashier is comparing against or fight it for width.

## Desktop behaviour (1536 × 1024)

Modal centred, 780px, capped at `100vh - 48px`; the list scrolls, the header and footer stay put. Rows are a single line — all four facts visible without truncation. `Resume` and `Discard` sit at the right, separated by a vertical rule. Opened by `Retrieve Bill (F4)` in Quick Actions, which also carries the count. Dismissed by `✕`, `Escape`, or backdrop click.

## Mobile behaviour (390 × 844)

The modal becomes a **bottom sheet** rising to 92% of the viewport with a rounded top edge — the natural phone idiom and reachable one-handed. The POS backdrop collapses to its own mobile layout behind it.

Each row restacks vertically: `REF` and customer, then note, then the four facts as a single evenly spaced row, then the actions full-width beneath. `Resume` takes the available width; `Discard` keeps a fixed width beside it. Both are 44px tall. Search and the segmented filter each take a full row. **The header, count and close control are always reachable without scrolling** — the clipping failure F10 hit at 390 is designed out here from the start.

## Resume behaviour

**The primary action, and visually unmistakable:** solid `blue-600`, the only filled control in each row, first in reading order.

On press it claims the held bill, replaces the current cart with its lines, restores the customer, closes the modal and returns the cashier to the till ready to take payment. The claim is a single conditional database write, so two tills pressing Resume on the same bill cannot both win — the loser is told "Another till already resumed this bill" rather than silently handed a duplicate cart. Expired or already-discarded bills fail the same way, each with its own message.

**If the current cart is not empty**, resuming would discard live work. The design intent is to ask first — see open question 4.

The amount in each row is labelled **"indicative"** for a real reason: prices are resolved from live catalogue data when the sale is completed, not frozen at hold time, so the figure shown may differ on resume. Saying so on the row is more honest than showing a number that quietly becomes wrong.

## Discard behaviour

**Secondary and destructive, and deliberately kept apart from Resume** — rose-tinted (`rose-50` fill, `rose-200` border, `rose-600` text), outlined rather than filled, placed after a vertical divider so it is never a mis-click away from Resume.

It removes the held bill from the list and does nothing else: no sale, no stock movement, no record in `/sales`. It should ask for confirmation, naming the customer and amount, because the cart cannot be recovered afterwards. Like Resume, it is guarded — discarding a bill another till has just resumed fails and says so.

## Empty state

The common case at the start of a shift, so it is a designed screen rather than a blank panel: a muted pause glyph, **"No held bills"**, one sentence explaining what the feature is for ("When a customer steps away, park their cart and serve the next person"), and a single `F3 Hold the current bill` hint. Search and the information banner are hidden — there is nothing to search and nothing to disclaim. The count badge reads `0`. The footer legend stays, so the two shortcuts remain discoverable.

## What was deliberately left out

No payment status, no invoice number, no ERP state, no sales history, no return/exchange, no PDF, no WhatsApp, no email, no analytics. None has a backend (see the audit's §3), and the codebase's standing rule — recorded in `PrintButton.tsx` — is that a control which silently does nothing is worse than no control.

The **`REF 7C4A` chip is not a bill number.** Held bills never consume `Store.nextBillSeq`; a bill number is allocated only when a sale completes. The chip is a short handle for reading one row out loud. If it risks being mistaken for a bill number, rename or drop it — open question 5.

Expiry is shown as a plain footer sentence with **no number**, because no TTL has been agreed. Once one is, it belongs on the row ("expires in 3h") rather than in the footer.

`F3` = Hold Bill and `F4` = Retrieve Bill throughout, matching the labels already printed on the two disabled buttons at `PosTerminal.tsx:585-586`. No alternative shortcut scheme was invented.

---

## Open questions requiring a product-owner decision

1. **Approve this layout?** It is a proposal, not an approved reference. Nothing should be built from it until you say so.
2. **Resume ownership.** The mock shows an "All holds / Mine" filter defaulting to **All holds** — anyone who may sell in the store can resume any of its holds. The alternative is cashier-owned, which strands carts at shift change. (Audit §6.)
3. **TTL.** No number is shown anywhere. Trading day, 24h, or per-tenant configurable? (Audit §8.)
4. **Resume with a non-empty cart.** Prompt to hold the current cart first, prompt to discard it, or refuse until the cart is cleared? The mock does not depict this dialog.
5. **The `REF` chip.** Keep it, rename it, or remove it, given it must never read as a bill number.
6. **Hold limit.** Cap per store or per cashier? The mock shows four; with forty the list needs pagination it does not currently have.
7. **F3 / F4 handlers.** The labels exist today on disabled buttons. Ship working shortcuts in F13, or keep the labels decorative as F10 chose to for F2/F3?
8. **Note field.** The mock shows an optional cashier note ("Getting cash from ATM"), which is the most useful column for identifying a parked cart. Confirm it should exist — it is a new field.
