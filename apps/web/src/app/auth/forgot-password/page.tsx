import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { AuthFrame } from "@/app/_components/AuthFrame";

export const metadata: Metadata = {
  title: "Forgot password — AMBURAX POS",
};

export default async function ForgotPasswordPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (session) {
    redirect("/dashboard");
  }

  return (
    <AuthFrame>
          <h2 className="text-3xl font-extrabold text-slate-900">Forgot password?</h2>
          <p className="mt-1 text-sm text-slate-600">
            We&apos;ll email you a link to reset it — this works whether or not the account
            exists, so no one can use this form to check who&apos;s registered.
          </p>
          <ForgotPasswordForm />
    </AuthFrame>
  );
}
