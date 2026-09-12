import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext, type PosContext } from "@/server/sales/posContext";
import { NavLinks } from "./NavLinks";
import { SignOutButton } from "./SignOutButton";

/**
 * Shell for the signed-in workspace.
 *
 * The shell never redirects and never blocks: each page owns its own authentication
 * decision, and a layout that redirected would fight the onboarding resume guard in
 * /home. When no context resolves — signed out, or a tenant still in onboarding — the
 * chrome simply is not rendered and the page beneath handles it.
 *
 * Scope note: this slice ships POS and Sales. Inventory and the dashboard are not built,
 * so they are not listed. A navigation item that led to a placeholder would be a promise
 * the product cannot keep.
 */
const NAV_ITEMS = [
  { href: "/pos", label: "POS" },
  { href: "/sales", label: "Sales" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  let context: PosContext | null = null;
  try {
    const resolved = await resolvePosContext(token);
    if (resolved.status === "ok") context = resolved.context;
  } catch (err) {
    // The shell degrades to bare content rather than failing the page. The page itself
    // still renders its own unavailable state if its data load fails.
    logError("app layout: context resolution failed", err);
  }

  if (!context) return <>{children}</>;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-slate-200 bg-white p-4 md:flex">
        <div>
          <StoreHeader storeName={context.storeName} storeCode={context.storeCode} />
          <div className="mt-6">
            <NavLinks items={NAV_ITEMS} />
          </div>
        </div>
        <div className="border-t border-slate-200 pt-4">
          <p className="truncate text-sm font-medium text-slate-900">{context.userName}</p>
          <p className="text-xs text-slate-500">
            {context.tenantRole === "OWNER" ? "Owner" : (context.membershipRole ?? "Staff")}
          </p>
          <div className="mt-3">
            <SignOutButton />
          </div>
        </div>
      </aside>

      {/* Narrow screens get the same navigation as a horizontal strip. A till is often a
          tablet, so the shell cannot assume a desktop sidebar is reachable. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 md:hidden">
          <span className="text-sm font-semibold text-slate-900">AMBURAX</span>
          <div className="flex gap-1">
            <NavLinks items={NAV_ITEMS} />
          </div>
        </div>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function StoreHeader({ storeName, storeCode }: { storeName: string; storeCode: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">AMBURAX</p>
      <p className="mt-2 truncate text-sm font-semibold text-slate-900">{storeName}</p>
      <p className="text-xs text-slate-500">{storeCode}</p>
    </div>
  );
}
