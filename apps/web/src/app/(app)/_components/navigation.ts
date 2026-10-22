/**
 * The AMBURAX product navigation.
 *
 * This structure is the product's real shape, taken from SCREEN_MAP.md and PHASES.md — not
 * a list of the screens that happen to be finished. A merchant should be able to see what
 * the system is, while never being misled about what works today.
 *
 * Hence `status` on every entry. `built` screens are real and do real work. `planned`
 * screens render an honest "not built yet" state naming the phase they belong to. There is
 * deliberately no third option: nothing here is allowed to look functional and not be.
 *
 * Phase numbers are the actual ones from PHASES.md, so a merchant reading "Phase 4" and a
 * developer reading the roadmap are looking at the same thing.
 */

export type NavStatus = "built" | "planned";

export interface NavItem {
  label: string;
  href: string;
  status: NavStatus;
  /** Shown on the placeholder screen and as the sidebar hint. Real phases only. */
  phase?: string;
  /** What the module will do. Used by the placeholder screen. */
  description?: string;
}

export interface NavSection {
  /** Undefined for the primary group, which needs no heading. */
  title?: string;
  items: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/dashboard", status: "built" },
      { label: "Operations", href: "/operations", status: "built" },
      { label: "Stores", href: "/stores", status: "built" },
      { label: "POS", href: "/pos", status: "built" },
      { label: "Till", href: "/till", status: "built" },
      { label: "Sales", href: "/sales", status: "built" },
      { label: "Inventory", href: "/inventory", status: "built" },
      { label: "Products", href: "/products", status: "built" },
      { label: "Customers", href: "/customers", status: "built" },
      { label: "Staff", href: "/staff", status: "built" },
      { label: "Cash & Day Close", href: "/cash", status: "built" },
      {
        label: "Customer Due (Khata)",
        href: "/khata",
        status: "built",
        phase: "Phase 5",
        description:
          "What each customer owes. Collecting payments stays off until the credit policy is decided.",
      },
      {
        label: "Suppliers",
        href: "/suppliers",
        status: "built",
        phase: "Phase 4",
        description:
          "Who you buy stock from: contacts, GSTIN and status.",
      },
      {
        label: "Purchases",
        href: "/purchases",
        status: "built",
        phase: "Phase 4",
        description:
          "Goods received from suppliers, with cost excluding GST and input GST.",
      },
      {
        label: "Offers & Loyalty",
        href: "/offers",
        status: "built",
        phase: "Phase 5",
        description:
          "Loyalty rules (off until finance and GST sign-off). Offers wait on their rules.",
      },
      {
        label: "Reports",
        href: "/reports",
        status: "built",
        phase: "Phase 11",
        description:
          "Retail, inventory and customer analytics with defined, reconcilable KPI definitions.",
      },
    ],
  },
  {
    title: "Commerce",
    items: [
      {
        label: "Commerce Overview",
        href: "/commerce",
        status: "built",
        phase: "Phase 6",
        description:
          "Channel connections, listings, mappings and order sync across Flipkart and marketplaces.",
      },
    ],
  },
  {
    title: "B2B",
    items: [
      {
        label: "Leads & Quotations",
        href: "/b2b",
        status: "built",
        phase: "Phase 9",
        description:
          "Lead ingestion, qualification, pipeline, quotations and conversion to sales orders.",
      },
    ],
  },
  {
    title: "AI",
    items: [
      {
        label: "AI Command Center",
        href: "/ai",
        status: "built",
        phase: "Phase 12",
        description:
          "Grounded sales, inventory and customer intelligence, with every high-risk action gated by approval.",
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        label: "Store & Settings",
        href: "/settings",
        status: "built",
        phase: "Phase 5",
        description:
          "Company credit defaults and POS terminal settings for your business.",
      },
    ],
  },
];

/** Flattened lookup for the placeholder screens, which resolve their own entry by path. */
export const NAV_BY_HREF: ReadonlyMap<string, NavItem> = new Map(
  NAVIGATION.flatMap((section) => section.items).map((item) => [item.href, item]),
);
