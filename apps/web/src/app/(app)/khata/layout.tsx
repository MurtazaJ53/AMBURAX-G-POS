import type { ReactNode } from "react";
import { SectionTabs, type SectionTab } from "@/components/shell/SectionTabs";

/** One tab strip across every screen of this area (same pattern as Inventory). */
const TABS: SectionTab[] = [
  { label: "Dues", href: "/khata" },
  { label: "Collect payment", href: "/khata/collect" },
  { label: "Customers", href: "/customers" },
];

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs tabs={TABS} label="Customer due sections" />
      {children}
    </>
  );
}
