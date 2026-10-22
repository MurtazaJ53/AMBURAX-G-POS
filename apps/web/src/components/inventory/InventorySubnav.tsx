"use client";

import { usePathname } from "next/navigation";
import { InventoryTabs } from "./InventoryTabs";

/**
 * Inventory's tab line on every screen it links to, with that screen marked. The overview page
 * (/inventory) draws the line itself under its header, so nothing is added there.
 */
export function InventorySubnav() {
  const path = usePathname() ?? "";
  if (path === "/inventory") return null;
  return (
    <nav aria-label="Inventory sections" className="border-b border-slate-200 px-4 sm:px-6">
      <InventoryTabs path={path} />
    </nav>
  );
}
