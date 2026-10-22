import type { ReactNode } from "react";
import { SectionTabs, type SectionTab } from "@/components/shell/SectionTabs";

/** One tab strip across every screen of this area (same pattern as Inventory). */
const TABS: SectionTab[] = [
  { label: "Tills", href: "/cash" },
  { label: "Day close", href: "/cash/day-close" },
];

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs tabs={TABS} label="Cash sections" />
      {children}
    </>
  );
}
