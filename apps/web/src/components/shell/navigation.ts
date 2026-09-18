import {
  LayoutDashboard,
  MonitorSmartphone,
  Tag,
  Package,
  Users,
  Briefcase,
  FileText,
  Percent,
  BarChart3,
  Globe,
  Settings,
  BrainCircuit,
  Building2,
  type LucideIcon,
} from "lucide-react";

export type NavStatus = "built" | "planned" | "disabled" | "not_implemented";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  status: NavStatus;
  phase?: string;
  description?: string;
  /** If specified, tenant must have at least one of these capabilities enabled. */
  capabilities?: string[];
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    items: [
      { id: "dashboard", label: "Dashboard", href: "/home", icon: LayoutDashboard, status: "built" },
      { id: "pos", label: "POS", href: "/pos", icon: MonitorSmartphone, status: "built", capabilities: ["RETAIL"] },
      { id: "sales", label: "Sales", href: "/sales", icon: Tag, status: "built" },
      { id: "inventory", label: "Inventory", href: "/inventory", icon: Package, status: "built" },
      { id: "products", label: "Products", href: "/products", icon: Briefcase, status: "built" },
      { id: "customers", label: "Customers", href: "/customers", icon: Users, status: "built" },
      {
        id: "khata",
        label: "Customer Due (Khata)",
        href: "/khata",
        icon: FileText,
        status: "planned",
        phase: "Phase 5",
        description: "Customer dues, collections and reminders. Sales can already be attributed to a customer, but no credit ledger exists yet.",
      },
      {
        id: "suppliers",
        label: "Suppliers",
        href: "/suppliers",
        icon: Building2,
        status: "planned",
        phase: "Phase 4",
        description: "Suppliers, purchase orders and goods receipts. Nothing in AMBURAX records inbound stock yet.",
      },
      {
        id: "offers",
        label: "Offers & Loyalty",
        href: "/offers",
        icon: Percent,
        status: "planned",
        phase: "Phase 5",
        description: "Offers, promotions and loyalty programmes. The till has no offer engine behind it yet.",
        capabilities: ["RETAIL"]
      },
      {
        id: "reports",
        label: "Reports",
        href: "/reports",
        icon: BarChart3,
        status: "planned",
        phase: "Phase 11",
        description: "Retail, inventory and customer analytics with defined, reconcilable KPI definitions.",
      },
    ],
  },
  {
    title: "Commerce",
    items: [
      {
        id: "commerce",
        label: "Commerce Overview",
        href: "/commerce",
        icon: Globe,
        status: "planned",
        phase: "Phase 6",
        description: "Channel connections, listings, mappings and order sync across Shopify, Amazon, Flipkart and Meesho.",
      },
    ],
  },
  {
    title: "B2B",
    items: [
      {
        id: "b2b",
        label: "Leads & Quotations",
        href: "/b2b",
        icon: Users,
        status: "planned",
        phase: "Phase 9",
        description: "Lead ingestion, qualification, pipeline, quotations and conversion to sales orders.",
        capabilities: ["WHOLESALE"]
      },
    ],
  },
  {
    title: "AI",
    items: [
      {
        id: "ai",
        label: "AI Command Center",
        href: "/ai",
        icon: BrainCircuit,
        status: "planned",
        phase: "Phase 12",
        description: "Grounded sales, inventory and customer intelligence, with every high-risk action gated by approval.",
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        id: "settings",
        label: "Store & Settings",
        href: "/settings/terminals",
        icon: Settings,
        status: "built",
        phase: "Phase 5",
        description: "Store profile, staff, shifts, terminals and integration settings in one workspace.",
      },
    ],
  },
];

export const NAV_BY_HREF: ReadonlyMap<string, NavItem> = new Map(
  NAVIGATION.flatMap((section) => section.items).map((item) => [item.href, item]),
);
