import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { Inter } from "next/font/google";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { LoginForm } from "./LoginForm";
import { MarketingPanel } from "./_components/MarketingPanel";
import {
  AppleLogo,
  GoogleLogo,
  IconChevronDown,
  IconCloud,
  IconGlobe,
  IconMonitor,
  IconShield,
  MicrosoftLogo,
} from "./_components/icons";

/**
 * The supplied design is set in Inter, and `next/font` self-hosts it: the browser makes no
 * request to Google, the font is served from our own origin, and the generated class is scoped to
 * the element it is put on. That last part is the reason it is imported here rather than in the
 * root layout — every other screen in the product keeps the type it already had.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sign in — AMBURAX POS",
};

/**
 * Sign-in.
 *
 * This file owns the session check and the page's shell; `LoginForm` owns the credentials and the
 * request. The split matters: the redirect below runs on the server before a byte of the login UI
 * is sent, so an already-authenticated visitor never sees this screen at all.
 *
 * The layout is the supplied design's: a full-width header, then a two-column body that collapses
 * to the sign-in column alone below `lg`.
 */
export default async function LoginPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (session) {
    redirect("/home");
  }

  return (
    <div
      className={`${inter.className} flex min-h-screen flex-col`}
      style={{ background: "#f8faff", color: "#1a1a2e" }}
    >
      {/* Top nav */}
      <header className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-lg font-extrabold text-white">
            A
          </div>
          <div>
            <div className="flex items-center gap-1">
              <span className="text-lg font-extrabold leading-none text-slate-800">AMBURAX</span>
              <span className="ml-1 text-lg font-extrabold leading-none text-blue-600">POS</span>
            </div>
            {/*
              Hidden on the narrowest phones. At 375px the mark, the wordmark, this tagline and
              the language control together overrun the viewport, and a horizontal scrollbar on a
              sign-in screen is worse than a missing strapline.
            */}
            <p className="mt-0.5 hidden text-xs text-slate-400 sm:block">
              Retail | Commerce | B2B | Powered by AI
            </p>
          </div>
        </div>
        {/*
          The design's language selector, preserved but inert. AMBURAX ships one language today —
          there is no locale routing, no message catalogue and nothing to switch to — so this
          announces the current language and says plainly that it cannot be changed. Wiring it to
          a menu with a single entry would be a control that pretends to do something.
        */}
        <button
          type="button"
          disabled
          title="AMBURAX is currently available in English only."
          aria-label="Language: English. Other languages are not available yet."
          className="flex shrink-0 cursor-default items-center gap-1.5 text-sm text-slate-600 disabled:opacity-100"
        >
          <IconGlobe />
          <span>English</span>
          <IconChevronDown />
        </button>
      </header>

      {/* Main split layout */}
      <div className="flex min-h-0 flex-1">
        <MarketingPanel />

        {/* ── Right sign-in panel ── */}
        <div className="flex w-full shrink-0 flex-col justify-center border-l border-slate-100 bg-white px-6 py-10 sm:px-12 lg:w-[480px] xl:w-[520px]">
          <div className="mx-auto w-full max-w-md">
            <h2 className="mb-1 text-center text-3xl font-extrabold text-slate-900">Welcome Back</h2>
            <p className="mb-8 text-center text-sm text-slate-500">
              Sign in to your Amburax POS account
            </p>

            <LoginForm />

            {/* Divider */}
            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs text-slate-400">Or continue with</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            {/*
              Social sign-in, shown and disabled.
              AMBURAX has no OAuth: no provider configuration, no callback route, no federated
              identity anywhere in src/server/identity. Buttons that opened a provider and then
              failed — or worse, appeared to succeed — would be the fake login behaviour this
              integration exists to avoid. They are kept visible because the design calls for them
              and because "coming soon" is true, and they are disabled so the promise is honest.
              The note below the row is what a screen reader and a sighted user both get.
            */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Google", logo: <GoogleLogo /> },
                { label: "Apple", logo: <AppleLogo /> },
                { label: "Microsoft", logo: <MicrosoftLogo /> },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled
                  title={`${p.label} sign-in is not available yet.`}
                  aria-label={`Continue with ${p.label} — not available yet`}
                  className="flex cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-700 opacity-50"
                >
                  {p.logo}
                  {p.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-center text-xs text-slate-400">
              Social sign-in isn&rsquo;t available yet. Use your email and password.
            </p>

            {/* Create account CTA */}
            <div className="mt-6 flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">New to Amburax POS?</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Join thousands of businesses growing with us.
                </p>
              </div>
              <Link
                href="/onboarding/business"
                className="ml-4 whitespace-nowrap rounded-xl border-2 border-blue-600 px-4 py-2 text-sm font-semibold text-blue-600 transition-all hover:bg-blue-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Create Account
              </Link>
            </div>

            {/* Trust badges */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {[
                { icon: <IconShield />, label: "Secure & Reliable" },
                { icon: <IconCloud />, label: "Cloud Based" },
                { icon: <IconMonitor />, label: "Access Anywhere" },
              ].map((b) => (
                <div key={b.label} className="flex items-center gap-1.5 text-xs text-slate-400">
                  {b.icon}
                  {b.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
