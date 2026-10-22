# Accessibility and Keyboard Workflows

| Document ID | AMB-DES-003 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Frontend Engineering Team |

---

## 1. Master Keyboard Shortcut Reference

AMBURAX G-POS is designed for 100% mouse-free counter operation. Every function key maps directly to standard cashier billing habits:

| Key Binding | POS Terminal Action | Context / Scope |
| :--- | :--- | :--- |
| **F1** | Focus Catalog Search / Product Query Box | Global Terminal |
| **F2** | Focus Barcode Scanner Input Box | Global Terminal |
| **F3** | Open Customer Selection / Khata Lookup Modal | Global Terminal |
| **F4** | Open Hold / Recall Cart Modal | Global Terminal |
| **F5** | Refresh Terminal State & Product Catalog Cache | Global Terminal |
| **F6** | Open Offers / Promotions Management Modal | Global Terminal |
| **F7** | Open Split Tender Payment Modal | Global Terminal |
| **F8** | Complete Sale / Submit Checkout | Global Terminal |
| **F9** | Open Salesperson Attribution Modal | Global Terminal |
| **F10** | Open Bill Discount Modal | Global Terminal |
| **F11** | Open More Actions / Drawer Kick / Bill Note | Global Terminal |
| **F12** | Open Keyboard Help / Shortcut Reference | Global Terminal |
| **ESC** | Close Active Modal / Dismiss Drawer | Active Modal |
| **Enter** | Confirm Selection / Submit Barcode Scan | Inputs & Forms |
| **Tab / Shift+Tab** | Navigate Form Fields & Modal Controls | Focus Navigation |

---

## 2. Accessibility & Screen Reader Compliance

- **ARIA Semantics**:
  - Modal dialogues use `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`.
  - Grid rows on the cart table implement standard `role="row"` and `role="cell"`.
- **Focus Management**:
  - Opening any modal traps keyboard focus inside the modal.
  - Pressing `ESC` closes the modal and returns focus to the search input (`F1`).
- **High Contrast Ratios**:
  - All text elements satisfy WCAG 2.2 Level AA requirements (contrast ratio > 4.5:1 against component backgrounds).
