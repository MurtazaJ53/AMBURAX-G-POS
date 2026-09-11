import type { Metadata } from "next";
import { BusinessRegistrationForm } from "./BusinessRegistrationForm";

export const metadata: Metadata = {
  title: "Register your business — AMBURAX POS",
};

// Unlike A1-A4, this page does NOT redirect an already-signed-in visitor away: a logged-in
// user's User row is permanently tied to their existing tenant (no multi-tenant user
// support), so registering an unrelated second business is a legitimate, harmless action
// here regardless of current session state.
export default function BusinessRegistrationPage() {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-slate-950 p-12 text-white lg:flex">
        <div className="text-lg font-semibold tracking-tight">AMBURAX POS</div>
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold leading-tight text-white">
            Set up your business in a few minutes.
          </h1>
          <p className="text-sm text-slate-300">
            One system for the counter, your online store, and everything in between —
            whatever you sell.
          </p>
        </div>
        <p className="text-xs text-slate-400">Step 1 of 6 — Business details</p>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <div className="text-lg font-semibold tracking-tight text-slate-900">AMBURAX POS</div>
          </div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Step 1 of 6</p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-900">Tell us about your business</h2>
          <p className="mt-1 text-sm text-slate-500">
            We'll use this to set up your workspace. You can change it later.
          </p>
          <BusinessRegistrationForm />
        </div>
      </section>
    </div>
  );
}
