import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { Inter } from "next/font/google";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { LoginForm } from "./LoginForm";
import { MarketingPanel } from "./_components/MarketingPanel";
import { IconCloud, IconGlobe, IconMonitor, IconShield } from "./_components/icons";

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
  title: "Sign in — AMBURAX",
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
    redirect("/dashboard");
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
          {/*
            "AMBURAX POS" understated the product: POS is one capability of a platform that also
            covers wholesale, manufacturing and commerce, and the name on the sign-in screen was
            the last place still describing it as a till. The blue accent the "POS" lockup carried
            now lives in the mark alone, which is why the mark stayed.
          */}
          <div>
            <span className="block text-lg font-extrabold leading-none text-slate-800">
              AMBURAX
            </span>
            {/*
              Hidden on the narrowest phones. At 375px the mark, the wordmark, this line and the
              language label together overrun the viewport, and a horizontal scrollbar on a
              sign-in screen is worse than a missing strapline.
            */}
            <p className="mt-1 hidden text-xs text-slate-400 sm:block">
              Business Operating Platform
            </p>
          </div>
        </div>
        {/*
          The current language, stated — not a selector.
          AMBURAX ships one language: no locale routing, no message catalogue, nothing to switch
          to. The design drew this as a dropdown, and a dropdown is a promise. Previously it was a
          disabled button, which still looked like a control that had been switched off; it is now
          simply a label, so there is nothing to press and nothing to be disappointed by. When a
          real locale system exists, this is the place to wire it — and only to that.
        */}
        <p className="flex shrink-0 items-center gap-1.5 text-sm text-slate-600">
          <IconGlobe />
          <span>English</span>
        </p>
      </header>

      {/* Main split layout */}
      <div className="flex min-h-0 flex-1">
        <MarketingPanel />

        {/* ── Right sign-in panel ── */}
        <div className="flex w-full shrink-0 flex-col justify-center border-l border-slate-100 bg-white px-6 py-10 sm:px-12 lg:w-[480px] xl:w-[520px]">
          <div className="mx-auto w-full max-w-md">
            <h2 className="mb-1 text-center text-3xl font-extrabold text-slate-900">Welcome Back</h2>
            <p className="mb-8 text-center text-sm text-slate-500">
              Sign in to your AMBURAX account
            </p>

            <LoginForm />

            {/*
              Where the design put "Or continue with" and three OAuth buttons.

              AMBURAX has no federated identity: no provider configuration, no callback route,
              nothing under src/server/identity that speaks OAuth. The buttons previously shipped
              visible-and-disabled, which is honest but still advertises a door that does not
              exist. They are gone, along with their divider, and the column is the better for it:
              the form now runs straight into the one thing a visitor without an account can
              actually do. Nothing replaced them, because a placeholder is a smaller version of
              the same lie.

              If OAuth is implemented later, this is the seam to reopen.
            */}

            {/* Create account CTA */}
            <div className="mt-8 flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">New to AMBURAX?</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Register your business and set up your first store.
                </p>
              </div>
              {/*
                `min-h-[44px]` and `inline-flex` rather than padding alone: `py-2` on a 14px line
                gives a 36px target, and this is a primary action that has to be hittable with a
                thumb. The border, radius and colour are the design's.
              */}
              <Link
                href="/onboarding/business"
                className="inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-xl border-2 border-blue-600 px-4 text-sm font-semibold text-blue-600 transition-all hover:bg-blue-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
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
