import {
  Activity,
  LayoutDashboard,
  MonitorSmartphone,
  ScanLine,
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
  Truck,
  UserCog,
  Wallet,
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
      { id: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, status: "built" },
      { id: "pos", label: "POS", href: "/pos", icon: MonitorSmartphone, status: "built", capabilities: ["RETAIL"] },
      { id: "sales", label: "Sales", href: "/sales", icon: Tag, status: "built" },
      { id: "inventory", label: "Inventory", href: "/inventory", icon: Package, status: "built" },
      { id: "products", label: "Products", href: "/products", icon: Briefcase, status: "built" },
      { id: "customers", label: "Customers", href: "/customers", icon: Users, status: "built" },
      { id: "staff", label: "Staff", href: "/staff", icon: UserCog, status: "built", description: "Who works in this store and pending invitations." },
      { id: "cash", label: "Cash & Day Close", href: "/cash", icon: Wallet, status: "built", description: "Till floats, cash paid in and out, and counting each shift at close." },
      {
        id: "khata",
        label: "Customer Due (Khata)",
        href: "/khata",
        icon: FileText,
        status: "built",
        phase: "Phase 5",
        description: "What each customer owes. Collecting payments stays off until the credit policy is decided.",
      },
      {
        id: "suppliers",
        label: "Suppliers",
        href: "/suppliers",
        icon: Building2,
        status: "built",
        phase: "Phase 4",
        description: "Who you buy stock from: contacts, GSTIN and status.",
      },
      { id: "operations", label: "Operations", href: "/operations", icon: Activity, status: "built", description: "Today at a glance: takings, tills, team, stock and approvals." },
      { id: "stores", label: "Stores", href: "/stores", icon: Building2, status: "built", description: "Every store side by side: sales, margin and stock value." },
      { id: "till", label: "Till", href: "/till", icon: ScanLine, status: "built", capabilities: ["RETAIL"], description: "The cashier's counter screen: open a shift, scan and sell." },
      {
        id: "purchases",
        label: "Purchases",
        href: "/purchases",
        icon: Truck,
        status: "built",
        phase: "Phase 4",
        description: "Goods received from suppliers, with cost excluding GST and input GST.",
      },
      {
        id: "offers",
        label: "Offers & Loyalty",
        href: "/offers",
        icon: Percent,
        status: "built",
        phase: "Phase 5",
        description: "Loyalty rules (off until finance and GST sign-off). Offers wait on their rules.",
        capabilities: ["RETAIL"]
      },
      {
        id: "reports",
        label: "Reports",
        href: "/reports",
        icon: BarChart3,
        status: "built",
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
        status: "built",
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
        status: "built",
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
        status: "built",
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
