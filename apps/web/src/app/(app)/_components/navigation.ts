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
      { label: "Dashboard", href: "/home", status: "built" },
      { label: "POS", href: "/pos", status: "built" },
      { label: "Sales", href: "/sales", status: "built" },
      { label: "Inventory", href: "/inventory", status: "built" },
      { label: "Products", href: "/products", status: "built" },
      { label: "Customers", href: "/customers", status: "built" },
      {
        label: "Customer Due (Khata)",
        href: "/khata",
        status: "planned",
        phase: "Phase 5",
        description:
          "Customer dues, collections and reminders. Sales can already be attributed to a customer, but no credit ledger exists yet.",
      },
      {
        label: "Suppliers",
        href: "/suppliers",
        status: "planned",
        phase: "Phase 4",
        description:
          "Suppliers, purchase orders and goods receipts. Nothing in AMBURAX records inbound stock yet.",
      },
      {
        label: "Offers & Loyalty",
        href: "/offers",
        status: "planned",
        phase: "Phase 5",
        description:
          "Offers, promotions and loyalty programmes. The till has no offer engine behind it yet.",
      },
      {
        label: "Reports",
        href: "/reports",
        status: "planned",
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
        status: "planned",
        phase: "Phase 6",
        description:
          "Channel connections, listings, mappings and order sync across Shopify, Amazon, Flipkart and Meesho.",
      },
    ],
  },
  {
    title: "B2B",
    items: [
      {
        label: "Leads & Quotations",
        href: "/b2b",
        status: "planned",
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
        status: "planned",
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
        href: "/settings/terminals",
        status: "built",
        phase: "Phase 5",
        description:
          "Store profile, staff, shifts, terminals and integration settings in one workspace.",
      },
    ],
  },
];

/** Flattened lookup for the placeholder screens, which resolve their own entry by path. */
export const NAV_BY_HREF: ReadonlyMap<string, NavItem> = new Map(
  NAVIGATION.flatMap((section) => section.items).map((item) => [item.href, item]),
);
