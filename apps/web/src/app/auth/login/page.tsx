import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { Inter } from "next/font/google";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { LoginForm } from "./LoginForm";
import { BrandBadge, Headline, MarketingPanel, STRAPLINE } from "./_components/MarketingPanel";
import { IconCloud, IconGlobe, IconMonitor, IconShield } from "./_components/icons";

/**
 * The supplied design is set in Inter, and `next/font` self-hosts it: the browser makes no
 * request to Google, the font is served from our own origin, and the generated class is scoped to
 * the element it is put on. That last part is the reason it is imported here rather than in the
 * root layout — every other screen in the product keeps the type it already had.
 *
 * (The authenticated shell still runs on `font-sans`, the platform UI face. Bringing it onto Inter
 * is a root-layout change affecting every screen in the product, so it is not made from this
 * route. It is the one remaining difference between this screen's type and the shell's, and it
 * belongs in a shared-token change of its own.)
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
 * The brand lockup, in the authenticated shell's language rather than the marketing design's.
 *
 * `AppSidebar` draws AMBURAX as a 20px tile carrying a bold "A" beside a 15px wordmark letterspaced
 * at .14em, with a 9px strapline under it. This screen used to draw a 40px `rounded-xl` tile beside
 * an 18px wordmark with no tracking — twice the mark, a different corner radius and a different
 * type size for the same brand, which is the loudest single reason the logged-out and logged-in
 * halves of the product did not look related. The measurements below are the shell's.
 *
 * The one deliberate difference: this tile is `--color-primary`, where the sidebar's is a literal
 * `sky-600` that appears in no token file. Correcting the sidebar is a shell change and outside
 * this screen's scope, so this takes the token, and the mismatch is recorded rather than copied.
 */
function BrandLockup() {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-5 shrink-0 place-items-center rounded text-[12px] font-bold leading-none text-white"
        style={{ background: "var(--color-primary)" }}
      >
        A
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-bold leading-none tracking-[.14em] text-slate-900">
          AMBURAX
        </span>
        {/*
          Hidden on the narrowest phones. At 375px the mark, the wordmark, this line and the
          language label together overrun the viewport, and a horizontal scrollbar on a sign-in
          screen is worse than a missing strapline.
        */}
        <span className="mt-1 hidden text-[9px] font-semibold uppercase leading-none tracking-[.08em] text-slate-500 sm:block">
          Business Operating Platform
        </span>
      </span>
    </div>
  );
}

const TRUST = [
  { icon: <IconShield />, label: "Secure & Reliable" },
  { icon: <IconCloud />, label: "Cloud Based" },
  { icon: <IconMonitor />, label: "Access Anywhere" },
];

/**
 * Sign-in.
 *
 * This file owns the session check and the page's shell; `LoginForm` owns the credentials and the
 * request. The split matters: the redirect below runs on the server before a byte of the login UI
 * is sent, so an already-authenticated visitor never sees this screen at all.
 *
 * ## The two compositions
 *
 * At `lg` and up this is the supplied design's split: value proposition left, sign-in right.
 *
 * Below `lg` it is not that layout with one half hidden, which is what it used to be — and what
 * left a 900px viewport showing a 448px form marooned in 900px of white with the product's entire
 * identity switched off. It is a second composition: the app background tint, the same header, a
 * compact restatement of the headline, and the form in a bordered white card. That is the shell's
 * own surface language — `--color-bg-app` behind `--color-bg-card` inside `--color-border` — so
 * the narrow layout reads as AMBURAX rather than as a form on a blank page.
 *
 * The card collapses back to a flush panel at `lg`, where the white column does the same job.
 */
export default async function LoginPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className={`${inter.className} flex min-h-screen flex-col bg-background-app text-primary`}>
      {/*
        68px, which is `AppSidebar`'s header height, on `border-slate-200`, which is the border
        every other chrome edge in the product uses. It was 73px on `border-slate-100` — close
        enough to read as a mistake rather than a decision, and far enough that the logged-out and
        logged-in headers never lined up.
      */}
      <header className="flex h-[68px] shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 lg:px-6">
        <BrandLockup />
        {/*
          The current language, stated — not a selector.

          AMBURAX ships one language: no locale routing, no message catalogue, nothing to switch
          to. The design drew this as a dropdown, and a dropdown is a promise. Previously it was a
          disabled button, which still looked like a control that had been switched off; it is now
          simply a label, so there is nothing to press and nothing to be disappointed by. When a
          real locale system exists, this is the place to wire it — and only to that.
        */}
        <p className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
          <IconGlobe />
          <span>English</span>
        </p>
      </header>

      <div className="flex min-h-0 flex-1">
        <MarketingPanel />

        {/* ── Sign-in column ── */}
        <div className="flex w-full min-w-0 flex-col justify-center px-4 py-8 sm:px-6 lg:w-[420px] lg:shrink-0 lg:border-l lg:border-slate-200 lg:bg-white lg:px-10 xl:w-[460px]">
          <div className="mx-auto w-full max-w-[400px] lg:max-w-none">
            {/*
              The compact identity, between `sm` and `lg`. Below `sm` it stays off: on a 390px
              screen the header lockup is identity enough, and everything above the fold should be
              the form. This is the band — tablets, small laptops, a 900px window — where there is
              room to say what the product is and the value-proposition panel is not being drawn.
            */}
            <div className="mb-7 hidden text-center sm:block lg:hidden">
              <BrandBadge />
              <Headline className="mt-3 text-[22px]" />
              <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-slate-500">
                {STRAPLINE}
              </p>
            </div>

            {/*
              A card below `lg`, a flush panel at `lg`. One element with two compositions rather
              than two elements and a `hidden`: a duplicated form is a form that can drift, and
              this one carries the only credentials input in the product.
            */}
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-card sm:p-7 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
              <h2 className="text-center text-2xl font-extrabold tracking-tight text-slate-900">
                Welcome Back
              </h2>
              <p className="mb-6 mt-1 text-center text-sm text-slate-500">
                Sign in to your AMBURAX account
              </p>

              <LoginForm />

              {/*
                Where the design put "Or continue with" and three OAuth buttons.

                AMBURAX has no federated identity: no provider configuration, no callback route,
                nothing under src/server/identity that speaks OAuth. The buttons previously shipped
                visible-and-disabled, which is honest but still advertises a door that does not
                exist. They are gone, along with their divider, and the column is the better for
                it: the form now runs straight into the one thing a visitor without an account can
                actually do. Nothing replaced them, because a placeholder is a smaller version of
                the same lie.

                If OAuth is implemented later, this is the seam to reopen.
              */}

              {/*
                Stacks below `sm`. Side by side on a 390px screen the sentence and the button each
                got about 150px, which wrapped "Register your business and set up your first
                store." onto three lines beside a button with nowhere to go.
              */}
              <div className="mt-6 flex flex-col gap-3 rounded-md border border-slate-200 bg-background-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800">New to AMBURAX?</p>
                  {/*
                    `slate-600`, not the `slate-500` every other secondary line on this screen
                    uses. This is the one string that sits on the tinted panel rather than on
                    white, and #64748b on #f1f5f9 measures 4.34:1 — under AA by a margin small
                    enough to be invisible and real enough to fail. On this background the next
                    step down the ramp is the correct one.
                  */}
                  <p className="mt-0.5 text-xs text-slate-600">
                    Register your business and set up your first store.
                  </p>
                </div>
                {/*
                  44px on touch, 40px from `lg` — the one control-height rule this screen has, and
                  the same one the inputs and the submit button follow. Before, this was 44, the
                  inputs were 46 and the submit was 48: three heights for three controls stacked
                  directly on top of each other.
                */}
                <Link
                  href="/onboarding/business"
                  className="inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-primary px-4 text-[13px] font-semibold transition-colors hover:bg-primary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 lg:h-10"
                  style={{ color: "var(--color-primary)" }}
                >
                  Create Account
                </Link>
              </div>
            </div>

            {/*
              Three columns on a phone rather than `flex-wrap`, which put two badges on one line
              and left "Access Anywhere" centred on its own underneath. The icons inherit the
              row's colour, so a glyph cannot disagree with its own label about contrast.
            */}
            <ul className="mt-6 grid grid-cols-3 gap-1 text-[11px] text-slate-500 sm:flex sm:justify-center sm:gap-x-5 sm:text-xs">
              {TRUST.map((b) => (
                <li
                  key={b.label}
                  className="flex items-center justify-center gap-1.5 whitespace-nowrap text-center"
                >
                  {/*
                    The glyphs go below `sm`. Three labels and three icons do not fit across
                    390px: at 11px "Access Anywhere" needs about 90px of the 114px a third of the
                    row gives it, and the 16px icon plus its gap takes 20 of those, which wrapped
                    one badge to two lines while its neighbours stayed on one. The labels are the
                    content; the icons are decoration, and decoration is what gets dropped.
                  */}
                  <span className="hidden sm:inline-flex">{b.icon}</span>
                  <span>{b.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
