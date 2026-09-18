"use client";

import * as React from "react";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { cn } from "@/lib/utils";

export interface AppShellProps {
  children: React.ReactNode;
  tenantCapabilities: string[];
  /** The business name, for the sidebar's brand block. */
  tenantName?: string;
  storeName: string;
  storeCode: string;
  userName: string;
  roleLabel: string;
  canSell: boolean;
  /** Whether a POS session is open in this store right now. */
  tillOpen?: boolean;
}

export function AppShell({
  children,
  tenantCapabilities,
  tenantName,
  storeName,
  storeCode,
  userName,
  roleLabel,
  canSell,
  tillOpen,
}: AppShellProps) {
  const [isMobileOpen, setIsMobileOpen] = React.useState(false);

  return (
    <div className="flex min-h-screen bg-background-app font-sans text-primary">
      <AppSidebar
        tenantCapabilities={tenantCapabilities}
        tenantName={tenantName}
        storeName={storeName}
        storeCode={storeCode}
        tillOpen={tillOpen}
        isMobileOpen={isMobileOpen}
        onMobileClose={() => setIsMobileOpen(false)}
      />

      {/* 13rem, matching the rail. The reference's sidebar is 208px and the content starts
          hard against it. */}
      <div className="flex min-w-0 flex-1 flex-col transition-[padding] lg:pl-52">
        <AppHeader
          storeName={storeName}
          storeCode={storeCode}
          userName={userName}
          roleLabel={roleLabel}
          canSell={canSell}
          tillOpen={tillOpen}
          onMobileMenuToggle={() => setIsMobileOpen(true)}
        />
        
        <main className="flex-1 min-w-0 flex flex-col">
          {children}
        </main>
      </div>
    </div>
  );
}
