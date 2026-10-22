import type { Metadata } from "next";
import { BusinessRegistrationForm } from "./BusinessRegistrationForm";
import { AuthFrame, ONBOARDING_STEPS } from "@/app/_components/AuthFrame";

export const metadata: Metadata = {
  title: "Register your business — AMBURAX POS",
};

// Unlike A1-A4, this page does NOT redirect an already-signed-in visitor away: a logged-in
// user's User row is permanently tied to their existing tenant (no multi-tenant user
// support), so registering an unrelated second business is a legitimate, harmless action
// here regardless of current session state.
export default function BusinessRegistrationPage() {
  return (
    <AuthFrame steps={ONBOARDING_STEPS} currentStep={1}>
          <h2 className="text-3xl font-extrabold text-slate-900">Tell us about your business</h2>
          <p className="mt-1 text-sm text-slate-600">
            We&apos;ll use this to set up your workspace. You can change it later.
          </p>
          <BusinessRegistrationForm />
    </AuthFrame>
  );
}
