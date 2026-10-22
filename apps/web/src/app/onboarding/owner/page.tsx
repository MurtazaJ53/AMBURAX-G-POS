import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { OwnerAccountForm } from "./OwnerAccountForm";
import { AuthFrame, ONBOARDING_STEPS } from "@/app/_components/AuthFrame";

export const metadata: Metadata = {
  title: "Create your owner account — AMBURAX POS",
};

export default async function OwnerAccountPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (session) {
    redirect("/dashboard");
  }

  return (
    <AuthFrame steps={ONBOARDING_STEPS} currentStep={2}>
          <h2 className="text-3xl font-extrabold text-slate-900">Create your owner account</h2>
          <p className="mt-1 text-sm text-slate-600">
            This is how you&apos;ll sign in to manage your business.
          </p>
          <OwnerAccountForm />
    </AuthFrame>
  );
}
