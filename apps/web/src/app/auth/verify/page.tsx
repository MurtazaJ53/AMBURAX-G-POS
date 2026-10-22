import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { VerifyForm } from "./VerifyForm";
import { AuthFrame, SIGN_IN_STEPS } from "@/app/_components/AuthFrame";

export const metadata: Metadata = {
  title: "Verify your identity — AMBURAX POS",
};

export default async function VerifyPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (session) {
    redirect("/dashboard");
  }

  return (
    <AuthFrame steps={SIGN_IN_STEPS} currentStep={2}>
          <h2 className="text-3xl font-extrabold text-slate-900">Verify your identity</h2>
          <p className="mt-1 text-sm text-slate-600">Enter the 6-digit code to finish signing in.</p>
          <VerifyForm />
    </AuthFrame>
  );
}
