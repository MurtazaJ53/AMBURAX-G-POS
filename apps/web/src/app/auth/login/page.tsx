import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in — AMBURAX POS",
};

/**
 * Closes audit finding P1-3.
 *
 * Every entry here must describe something the repository can actually do today. The
 * previous copy advertised an online store and B2B orders (no commerce, B2B, catalog or
 * order code exists), barcode checkout, an offline-capable POS and real-time stock (no
 * checkout, no local store, no queue, no sync, and no stock anywhere), and automatic
 * posting into ERPNext ledgers (no ERPNext is installed at all — see
 * ERPNext_VERSION_PIN.md; the `erpnext*` columns are placeholders sitting at
 * NOT_PROVISIONED).
 *
 * The offline blueprint in OFFLINE_POS.md stays exactly as it is. It is a design document
 * and says so. The defect was asserting it on a screen a merchant reads as a statement of
 * what they are buying.
 *
 * The rule for editing this list: if you cannot point at the route, service and test that
 * implement a claim, it does not belong here.
 */
const FEATURES = [
  {
    // A5/A7 create the tenant and store; A8/A11 invite and admit staff; StoreMembership
    // carries a per-store role.
    title: "Your team, your stores",
    body: "Set up your business and stores, invite staff by email, and give each person the right access in each store.",
  },
  {
    // A9: PosDevice, one-time pairing code, derived status, disable without deletion.
    title: "Terminals you control",
    body: "Register each POS terminal, pair it to the device at the counter, and disable one later without losing its record.",
  },
  {
    // A1-A4: password + MFA challenge, single-use hashed tokens, rate limiting, AuditLog.
    title: "Secure by default",
    body: "Two-step sign-in, single-use invitation and reset links, and an audit trail behind every administrative action.",
  },
];

export default async function LoginPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (session) {
    redirect("/home");
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-slate-950 p-12 text-white lg:flex">
        <div className="text-lg font-semibold tracking-tight">AMBURAX POS</div>
        <div className="space-y-8">
          <h1 className="text-3xl font-semibold leading-tight text-white">
            Run your whole retail business from one command center.
          </h1>
          <ul className="space-y-6">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <p className="font-medium text-white">{f.title}</p>
                <p className="mt-1 text-sm text-slate-300">{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
        {/*
          Was "Trusted by garment and general retail businesses." — social proof for
          customers that do not exist. "Built for" is a statement of who the product is
          designed for, which PROJECT.md does support, and claims nothing about adoption.
        */}
        <p className="text-xs text-slate-400">Built for garment and general retail.</p>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="text-lg font-semibold tracking-tight text-slate-900">AMBURAX POS</div>
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue to your store.</p>
          <LoginForm />
        </div>
      </section>
    </div>
  );
}
