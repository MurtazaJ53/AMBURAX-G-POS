"use client";

import * as React from "react";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import type { StoreOption } from "./StoreSwitcher";

export interface AppShellProps {
  children: React.ReactNode;
  tenantCapabilities: string[];
  /** The business name, for the sidebar's brand block. */
  tenantName?: string;
  storeName: string;
  storeCode: string;
  storeId?: string;
  availableStores?: StoreOption[];
  userName: string;
  roleLabel: string;
  canSell: boolean;
  /** Whether a POS session is open in this store right now. */
  tillOpen?: boolean;
  /** Custom allowed modules for this staff member (null = unrestricted / role default). */
  allowedModules?: string[] | null;
}

export function AppShell({
  children,
  tenantCapabilities,
  tenantName,
  storeName,
  storeCode,
  storeId,
  availableStores,
  userName,
  roleLabel,
  canSell,
  tillOpen,
  allowedModules,
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
        allowedModules={allowedModules}
        isMobileOpen={isMobileOpen}
        onMobileClose={() => setIsMobileOpen(false)}
      />

      {/* 244px, matching the reference's rail. */}
      <div className="flex min-w-0 flex-1 flex-col transition-[padding] lg:pl-[238px]">
        <AppHeader
          storeName={storeName}
          storeCode={storeCode}
          storeId={storeId}
          availableStores={availableStores}
          userName={userName}
          roleLabel={roleLabel}
          canSell={canSell}
          tillOpen={tillOpen}
          onMobileMenuToggle={() => setIsMobileOpen(true)}
        />
        
        <main className="flex-1 min-w-0 flex flex-col [&>*]:w-full [&>*]:min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
