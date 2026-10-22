import type { ReactNode } from "react";
import { SectionTabs, type SectionTab } from "@/components/shell/SectionTabs";

/** One tab strip across every screen of this area (same pattern as Inventory). */
const TABS: SectionTab[] = [
  { label: "Team", href: "/staff" },
  { label: "Attendance", href: "/staff/attendance" },
  { label: "Shifts", href: "/staff/shifts" },
  { label: "Leave", href: "/staff/leave" },
];

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionTabs tabs={TABS} label="Staff sections" />
      {children}
    </>
  );
}
