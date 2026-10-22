import type { ReactNode } from "react";
import { SectionTabs, type SectionTab } from "@/components/shell/SectionTabs";

/** One tab strip across every screen of this area (same pattern as Inventory). */
const TABS: SectionTab[] = [
  { label: "General", href: "/settings" },
  { label: "Company", href: "/settings/company" },
  { label: "POS", href: "/settings/pos" },
  { label: "Terminals", href: "/settings/terminals" },
  { label: "Security", href: "/settings/security" },
  { label: "System health", href: "/settings/system-health" },
  { label: "Export", href: "/settings/export" },
  { label: "Import data", href: "/settings/import" },
];

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs tabs={TABS} label="Settings sections" />
      {children}
    </>
  );
}
