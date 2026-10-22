"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The tab strip each area shows above its screens, the same pattern as Inventory's: every screen of
 * an area is one tab away, and the current one is marked. The active tab is the longest href that
 * the current path starts with, so /staff/attendance marks "Attendance", not "Team".
 */
export type SectionTab = { label: string; href: string };

const BASE =
  "amb-focus inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-[12px] font-semibold transition-colors";
const ACTIVE = `${BASE} border-primary text-primary`;
const IDLE = `${BASE} border-transparent text-secondary hover:text-primary`;

export function SectionTabs({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  const path = usePathname() ?? "";
  const active = tabs
    .filter((t) => path === t.href || path.startsWith(`${t.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label={label} className="border-b border-slate-200 px-4 sm:px-6">
      <div className="scrollbar-hide -mb-px flex items-center gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined} className={t.href === active ? ACTIVE : IDLE}>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
