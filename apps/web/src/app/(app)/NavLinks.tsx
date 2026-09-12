"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Navigation for the authenticated workspace.
 *
 * Client-side only because the active state depends on the current path. Which links
 * exist is decided on the server and passed in — hiding a link is presentation, never
 * permission, and every destination re-checks the caller for itself.
 */
export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                : "rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
