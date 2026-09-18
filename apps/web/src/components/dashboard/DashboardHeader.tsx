import * as React from "react";
import Link from "next/link";
import { CalendarDays, Package, Plus, Users } from "lucide-react";

/**
 * The page header: who is looking, at which store, on which trading day, and the handful of
 * things they are most likely to do next.
 *
 * The date is the *trading* day, not today's wall-clock date, and the two differ for anyone
 * still working at one in the morning. The quick actions mirror the reference's row, with the
 * one that opens the till shown only where the operator may actually sell — a button that
 * leads to a permission error is worse than no button.
 */

export interface DashboardHeaderProps {
  greeting: string;
  userName: string;
  storeName: string;
  tradingDay: string;
  canSell: boolean;
}

function QuickAction({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-background-card px-3 py-2 text-xs font-medium text-secondary transition-colors hover:bg-background-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </Link>
  );
}

export function DashboardHeader({
  greeting,
  userName,
  storeName,
  tradingDay,
  canSell,
}: DashboardHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-primary">
          {greeting}, {userName}
        </h1>
        <p className="mt-0.5 text-sm text-secondary">
          Here&apos;s what&apos;s happening at {storeName} today
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background-card px-3 py-2 text-xs font-medium text-secondary">
          <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
          {tradingDay}
        </span>

        {canSell && (
          <QuickAction href="/pos" icon={Plus}>
            Open till
          </QuickAction>
        )}
        <QuickAction href="/products" icon={Package}>
          Products
        </QuickAction>
        <QuickAction href="/customers" icon={Users}>
          Customers
        </QuickAction>
      </div>
    </div>
  );
}
