"use client";

import * as React from "react";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { cn } from "@/lib/utils";

export interface AppShellProps {
  children: React.ReactNode;
  tenantCapabilities: string[];
  storeName: string;
  storeCode: string;
  userName: string;
  roleLabel: string;
  canSell: boolean;
}

export function AppShell({
  children,
  tenantCapabilities,
  storeName,
  storeCode,
  userName,
  roleLabel,
  canSell,
}: AppShellProps) {
  const [isMobileOpen, setIsMobileOpen] = React.useState(false);

  return (
    <div className="flex min-h-screen bg-background-app text-primary font-sans">
      <AppSidebar 
        tenantCapabilities={tenantCapabilities} 
        isMobileOpen={isMobileOpen} 
        onMobileClose={() => setIsMobileOpen(false)} 
      />
      
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60 transition-[padding]">
        <AppHeader
          storeName={storeName}
          storeCode={storeCode}
          userName={userName}
          roleLabel={roleLabel}
          canSell={canSell}
          onMobileMenuToggle={() => setIsMobileOpen(true)}
        />
        
        <main className="flex-1 min-w-0 flex flex-col">
          {children}
        </main>
      </div>
    </div>
  );
}
