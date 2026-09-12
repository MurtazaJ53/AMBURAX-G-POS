import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Forgot password — AMBURAX POS",
};

export default async function ForgotPasswordPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (session) {
    redirect("/home");
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-slate-950 p-12 text-white lg:flex">
        <div className="text-lg font-semibold tracking-tight">AMBURAX POS</div>
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold leading-tight text-white">Locked out isn&apos;t the end of the day.</h1>
          <p className="text-sm text-slate-300">
            Enter the email on your account and we&apos;ll send a link to set a new password.
          </p>
        </div>
        <p className="text-xs text-slate-400">Built for garment and general retail.</p>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="text-lg font-semibold tracking-tight text-slate-900">AMBURAX POS</div>
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">Forgot password?</h2>
          <p className="mt-1 text-sm text-slate-500">
            We&apos;ll email you a link to reset it — this works whether or not the account
            exists, so no one can use this form to check who&apos;s registered.
          </p>
          <ForgotPasswordForm />
        </div>
      </section>
    </div>
  );
}
