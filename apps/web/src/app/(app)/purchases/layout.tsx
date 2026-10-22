import type { ReactNode } from "react";
import { SectionTabs, type SectionTab } from "@/components/shell/SectionTabs";

/** One tab strip across every screen of this area (same pattern as Inventory). */
const TABS: SectionTab[] = [
  { label: "Receipts", href: "/purchases" },
  { label: "Orders", href: "/purchases/orders" },
  { label: "Suppliers", href: "/suppliers" },
];

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs tabs={TABS} label="Purchasing sections" />
      {children}
    </>
  );
}
