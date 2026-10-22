import type { ReactNode } from "react";
import { InventorySubnav } from "@/components/inventory/InventorySubnav";

/** Inventory's tab line stays on every screen it links to (same pattern as the other areas). */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <InventorySubnav />
      {children}
    </>
  );
}
