import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in — AMBURAX POS",
};

const FEATURES = [
  {
    title: "One system, every channel",
    body: "Run the counter, your online store, and B2B orders from a single source of truth.",
  },
  {
    title: "Built for the floor",
    body: "Fast barcode checkout, offline-capable POS, and real-time stock across stores.",
  },
  {
    title: "ERPNext-grade accounting",
    body: "Sales, tax and stock post straight into your existing ERPNext ledgers — nothing to reconcile by hand.",
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
        <p className="text-xs text-slate-400">Trusted by garment and general retail businesses.</p>
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
