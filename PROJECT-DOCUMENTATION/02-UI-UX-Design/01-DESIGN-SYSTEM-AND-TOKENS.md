# UI/UX Design System & Design Tokens

| Document ID | AMB-DES-001 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Product Design & Frontend Architecture Team |

---

## 1. Design Philosophy

AMBURAX G-POS interface is designed for high-throughput environments where cashier cognitive load must be minimized. The terminal adheres to the following core tenets:

1. **Information Density without Clutter**: High data density designed specifically for 1080p and 720p counter touchscreens and desktop monitors.
2. **Keyboard First**: Every button has a visible keyboard shortcut indicator (e.g. `[F1]`, `[F8]`, `[ESC]`).
3. **High Contrast for Glare Environments**: Counter lighting is often harsh; high contrast typography and clear border separators prevent misreading prices.
4. **Micro-Interactions & Auditory Cues**: Web Audio API beeps deliver immediate feedback for scan success, quantity updates, and errors without requiring the cashier to look away from the physical scanner.

---

## 2. Color System & Design Tokens

```css
:root {
  /* Brand Primitives */
  --color-brand-primary: #0284c7;     /* Sky 600 - Primary actions & Active state */
  --color-brand-accent: #0ea5e9;      /* Sky 500 - Highlight */
  --color-brand-surface: #f0f9ff;     /* Sky 50 - Subtle selection */

  /* Neutral Spectrum */
  --color-bg-canvas: #f8fafc;         /* Slate 50 - Background */
  --color-bg-card: #ffffff;           /* Pure White - Component surface */
  --color-border-subtle: #e2e8f0;     /* Slate 200 - Dividers */
  --color-border-strong: #94a3b8;     /* Slate 400 - Focused inputs */
  --color-text-main: #0f172a;         /* Slate 900 - Primary headings & amounts */
  --color-text-muted: #64748b;        /* Slate 500 - Secondary labels & SKU */

  /* Semantic Feedback */
  --color-success: #16a34a;           /* Green 600 - Sale complete, Paid in full */
  --color-warning: #ea580c;           /* Orange 600 - Overdue bill, Low stock */
  --color-danger: #dc2626;            /* Red 600 - Void line, Credit exceeded */
  --color-info: #2563eb;              /* Blue 600 - Active offer applied */

  /* Spacing Scale */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;

  /* Typography */
  --font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace; /* Used for Bill Numbers, SKUs, Currency */
}
```

---

## 3. UI Component Library

### 3.1 Cart Line Item Table
- **Layout**: Column headers: Item Description, SKU, Sizing/Color, Rate, Qty, Line Discount, Net Total.
- **Micro-controls**: Inline quantity adjuster (`+` / `-`), trash icon (`Del`), line-discount trigger.
- **Visual Distinction**: Lines with active promotional discounts display a badge with savings in emerald green.

### 3.2 Counter Modals
- **Modals**:
  - `ApplyOfferModal` (`F6`): Lists active promotions, radio picker for single-offer mode, start/stop toggle, add offer form, and "Clear / Remove Offer" button.
  - `CustomerPickerModal` (`F3`): Search by mobile number or name; shows customer credit balance, phone verification status, and quick create.
  - `SplitPaymentModal` (`F7`): Dynamic rows for Cash, Card, UPI, and Udhar with auto-reconciled remaining tender indicator.
  - `HoldCartModal` (`F4`): Displays timestamped held carts with item counts and total amount.

### 3.3 Visual Scale
- To ensure optimal viewing across all retail monitor formats, the POS terminal runs at a calibrated standard scale (`103%` zoom) with responsive flex-grid layouts.
