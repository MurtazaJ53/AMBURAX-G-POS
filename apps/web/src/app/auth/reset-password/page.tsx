import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { AuthFrame } from "@/app/_components/AuthFrame";

export const metadata: Metadata = {
  title: "Reset password — AMBURAX POS",
};

export default async function ResetPasswordPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (session) {
    redirect("/dashboard");
  }

  return (
    <AuthFrame>
          <h2 className="text-3xl font-extrabold text-slate-900">Reset your password</h2>
          <p className="mt-1 text-sm text-slate-600">Choose a new password for your account.</p>
          <Suspense fallback={<div className="mt-8 h-40 animate-pulse rounded-lg bg-slate-100" aria-hidden="true" />}>
            <ResetPasswordForm />
          </Suspense>
    </AuthFrame>
  );
}
