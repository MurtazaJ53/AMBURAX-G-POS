# Known issues

Defects we know about and have chosen not to fix yet. Each entry says what fails, why, and how we know. Remove an entry when it's fixed.

---

## KI-1: 17 component tests fail (posScan, catalog)

**Opened:** 2026-10-23. **Status:** open, not being fixed yet (owner decision).
**Run:** `npm run test:component` in `apps/web` gives 17 failed, 158 passed (175). The unit suite (`npm test`) is unaffected and passes.
**Already failing before 2026-10-23:** the same 17 fail with the GST/cart changes from that day removed.

**Cause (both files):** each test replaces `lucide-react` with a hand-written `vi.mock` that lists only the icons the component used when the test was written. The components now also import icons that the mock doesn't list, so the component fails to render and every test in the file fails.

| File | Missing icon in the mock | Failing tests |
|---|---|---|
| `src/test-component/posScan.test.tsx` | `Camera` | 9 |
| `src/test-component/catalog.test.tsx` | `ArrowRight` | 8 |

**posScan.test.tsx: POS barcode scanning**
1. adds a scanned item through the exact barcode endpoint, clears the box and keeps focus
2. a repeated scan increments the existing line instead of adding a second one
3. names a withdrawn item and leaves the cart empty
4. reports an unknown barcode, keeps the typed text for name search, and leaves the cart empty
5. an ordinary name search still uses catalogue search; Enter on it adds nothing
6. does nothing on an empty Enter
7. shows an error on a network failure, leaves the cart empty and keeps focus
8. shows a server failure as an error, not as an unknown barcode
9. checkout sends only variant and quantity, never the scan response's price

**catalog.test.tsx**
1. the panel opens on Stock and sums the real per-store counts
2. the variant count is the product's own, not the reference's fixed twelve
3. the pricing tab lists every variant and refuses to state a margin
4. the images tab shows the one real picture and explains the single-image limit
5. the sales tab reports real figures over a named window
6. a product that has never sold says so instead of showing zeroes
7. edit and create-variant are hidden from someone who may not manage the catalogue
8. no unbacked quick actions are offered

**Likely fix (not done):** have the mock spread the real module (`...(await importOriginal())`) or return a stub for any icon name, so a new icon can't break the suite again. More failures may show up once these files render, because the tests haven't actually exercised the components since the icons were added.

**Risk while open:** barcode scanning on the POS screen and the catalogue product panel have no working component tests.

---

## KI-2: till component tests fail intermittently

**Opened:** 2026-10-23. **Status:** open, cause not found.
**Run:** the four till files together (`tillSession`, `tillSale`, `tillScan`, `tillAccessibility` in `src/test-component/`).

A different test fails each time, usually because an element isn't found in time or an assertion runs before the screen settles. Examples seen: "never overrides the natural tab order", "clears the last scan message with Escape", "steps a quantity up and removes the line when it falls below one", and the close-shift button not being found.

**Possibly caused by commit 99dd0e3** (passing the GST flag through the till): on the code after that commit, 4 of 18 runs had failures; on the code before it, 0 of 11. That commit changes nothing these tests can observe (they all render with `gstRegistered` true), and no mechanism has been found, so this may be machine load. Next step: run each side 30+ times on an idle machine before deciding.
