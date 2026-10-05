# Dashboard Part 1 Audit Findings

## 1. Current
The dashboard shell and header currently use hardcoded arbitrary values (e.g., `text-[24px]`, `text-[13px]`) rather than standard design tokens. The header actions are loosely grouped, and the flex wrapping on mobile can be messy. The "Sales History" link doesn't match the reference's "Generate Report". The spacing in the shell (`px-5 py-4`) feels slightly cramped for a desktop enterprise view, though functional.

## 2. Problem
- **Weak Hierarchy**: The arbitrary text sizes break from the typical Tailwind scale (`text-2xl`, `text-sm`), leading to inconsistencies with other pages.
- **Header Density**: Action buttons have varying padding/margins and feel disconnected. The date/time grouping is a bit disjointed.
- **Copy**: "Sales History" differs from the reference ("Generate Report").
- **Spacing/Alignment**: Gap sizes between the title area and actions can cause awkward wrapping on mid-size screens.

## 3. Recommended redesign
- Use standard Tailwind utility classes (`text-2xl`, `text-sm`, `text-muted-foreground`) to leverage the existing design system.
- Refine the action bar to clearly separate the context (Today/Date) from the primary actions (POS, Add Item, Receive Stock, Generate Report).
- Improve responsive wrapping behavior by using `flex-wrap` with appropriate `gap` and `justify-between` to keep the header breathing.
- Adjust button styling to match standard secondary/primary button aesthetics (using standard utility classes or existing button components).

## 4. Exact visual changes
- Title: Change `text-[24px]` to `text-2xl font-bold tracking-tight text-foreground`.
- Subtitle: Change `text-[13px] text-slate-500` to `text-sm text-muted-foreground`.
- Date block: Wrap "Today (Live)" and the date in a more cohesive bordered container, matching the reference.
- Action Buttons: Ensure uniform height, replace "Sales History" with "Generate Report", and refine borders and hover states. Use `text-sm` for action labels.
- Page padding: Expand page padding slightly on larger screens (`px-4 md:px-6 lg:px-8 py-6`).

## 5. Exact motion changes
- Add a subtle `transition-colors duration-200` to all action buttons to ensure smooth hover states.

## 6. Accessibility changes
- Ensure the header `<h1>` is the clear primary landmark.
- Add `aria-label` to icon-only or complex button contents if necessary.
- Verify focus rings (`focus-visible:ring-2`) on all header links.

## 7. Responsive changes
- Use `flex-col md:flex-row` for the main header to ensure it stacks neatly on mobile (`390x844`) and sits inline on desktop (`1024+`).
- Allow button groups to wrap gracefully (`flex-wrap`) without clipping.
