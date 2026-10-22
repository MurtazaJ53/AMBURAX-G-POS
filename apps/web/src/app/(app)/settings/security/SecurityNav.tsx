import Link from "next/link";
import { Database, FileText, KeyRound, Lock, MonitorSmartphone, Settings2, Users } from "lucide-react";

/**
 * The A13/A14 section menu, as the reference design lays it out. Sections with nothing behind
 * them yet are shown as planned and are not links, so nothing here promises a screen that
 * does not exist.
 */
const SECTIONS = [
  { id: "access", href: "/settings/security", label: "Login & access", hint: "Password and two-step sign-in", icon: Lock },
  {
    id: "sessions",
    href: "/settings/security/sessions",
    label: "Sessions & devices",
    hint: "Where you're signed in",
    icon: MonitorSmartphone,
  },
  { id: "pin", href: "/settings", label: "Approval PIN", hint: "Approve cashier discounts", icon: KeyRound },
  { id: "permissions", href: "/settings/security/permissions", label: "User permissions", hint: "Roles and access", icon: Users },
  { id: "data", href: "/settings/security/data", label: "Data security", hint: "Backup and encryption", icon: Database },
  { id: "audit", href: "/settings/security/audit", label: "Audit logs", hint: "Every important action", icon: FileText },
  { id: "advanced", href: "/settings/security/advanced", label: "Advanced", hint: "More security options", icon: Settings2 },
] as const;

export function SecurityNav({ active }: { active: "access" | "sessions" | "audit" | "permissions" | "data" | "advanced" }) {
  return (
    <nav aria-label="Security sections" className="rounded-xl border border-slate-200 bg-white p-2">
      <ul className="space-y-1">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const isActive = s.id === active;
          const body = (
            <>
              <Icon aria-hidden="true" className={`mt-0.5 h-5 w-5 shrink-0 ${isActive ? "text-blue-600" : "text-slate-500"}`} />
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-semibold ${isActive ? "text-blue-700" : "text-slate-800"}`}>
                  {s.label}
                </span>
                <span className="block text-xs text-slate-600">{s.hint}</span>
              </span>
              {!("href" in s) && (
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  Planned
                </span>
              )}
            </>
          );
          return (
            <li key={s.id}>
              {"href" in s ? (
                <Link
                  href={s.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`amb-focus flex min-h-11 items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                    isActive ? "bg-blue-50" : "hover:bg-slate-50"
                  }`}
                >
                  {body}
                </Link>
              ) : (
                <div aria-disabled="true" className="flex items-start gap-3 rounded-lg px-3 py-2.5 opacity-80">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
