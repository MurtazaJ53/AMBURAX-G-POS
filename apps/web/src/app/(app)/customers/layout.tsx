import type { ReactNode } from "react";
import { SectionTabs, type SectionTab } from "@/components/shell/SectionTabs";

/** One tab strip across every screen of this area (same pattern as Inventory). */
const TABS: SectionTab[] = [
  { label: "Customers", href: "/customers" },
  { label: "Top Customers", href: "/customers/top" },
  { label: "Segments", href: "/customers/segments" },
  { label: "Customer due", href: "/khata" },
];

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs tabs={TABS} label="Customer sections" />
      {children}
    </>
  );
}
