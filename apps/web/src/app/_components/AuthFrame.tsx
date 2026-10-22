import type { ReactNode } from "react";
import Link from "next/link";
import { Inter } from "next/font/google";
import { Check } from "lucide-react";
import { MarketingPanel } from "@/app/auth/login/_components/MarketingPanel";
import { IconCloud, IconGlobe, IconMonitor, IconShield } from "@/app/auth/login/_components/icons";

/**
 * The shared frame of every sign-in and setup screen (A1–A14), as the phase-1 reference designs
 * draw it: brand header, the brand panel on the left, the task in a white card on the right with
 * an optional step indicator, and the trust line underneath.
 *
 * One component so the screens cannot drift apart again: before this, Login had the reference
 * layout and every other auth screen still carried an older dark panel.
 */

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap" });

export interface AuthStep {
  label: string;
}

/** The setup journey, A5–A10, in the order the reference designs number it. */
export const ONBOARDING_STEPS: AuthStep[] = [
  { label: "Business details" },
  { label: "Owner account" },
  { label: "Store setup" },
  { label: "Team invitation" },
  { label: "POS setup" },
  { label: "Complete" },
];

export const SIGN_IN_STEPS: AuthStep[] = [{ label: "Sign in" }, { label: "Verify" }, { label: "Access" }];

function Stepper({ steps, current }: { steps: AuthStep[]; current: number }) {
  return (
    <ol aria-label="Progress" className="mb-8 flex items-start">
      {steps.map((step, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li
            key={step.label}
            aria-current={active ? "step" : undefined}
            className="relative flex flex-1 flex-col items-center text-center"
          >
            {i < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={`absolute left-1/2 top-[18px] h-0.5 w-full origin-left ${
                  done ? "amb-line-in bg-primary" : "bg-slate-200"
                }`}
              />
            )}
            <span
              className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                done
                  ? "bg-primary text-white"
                  : active
                    ? "bg-primary text-white ring-4 ring-blue-100"
                    : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              {done ? <Check aria-hidden="true" className="h-4 w-4" strokeWidth={3} /> : n}
              <span className="sr-only">
                {` ${step.label}`}
                {done ? " (done)" : active ? " (current)" : ""}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={`mt-2 hidden max-w-[88px] text-[11px] leading-tight sm:block ${
                active ? "font-semibold text-blue-700" : "text-slate-600"
              }`}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function AuthFrame(props: {
  children: ReactNode;
  /** Shown on the right of the header, e.g. the signed-in person. */
  headerRight?: ReactNode;
  steps?: AuthStep[];
  /** 1-based. */
  currentStep?: number;
  /** Wider card for list-heavy steps (store selection, team, POS setup). */
  wide?: boolean;
}) {
  return (
    <div className={`${inter.className} flex min-h-screen flex-col`} style={{ background: "#f8faff", color: "#1a1a2e" }}>
      <header className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4 sm:px-8">
        <Link href="/auth/login" className="amb-focus flex items-center gap-3 rounded-lg">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-lg font-extrabold text-white">
            A
          </span>
          <span>
            <span className="block text-lg font-extrabold leading-none text-slate-800">AMBURAX</span>
            <span className="mt-1 hidden text-xs text-slate-500 sm:block">Business Operating Platform</span>
          </span>
        </Link>
        {props.headerRight ?? (
          <p className="flex shrink-0 items-center gap-1.5 text-sm text-slate-600">
            <IconGlobe />
            <span>English</span>
          </p>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <MarketingPanel />

        <main
          className={`flex w-full shrink-0 flex-col justify-center border-l border-slate-100 bg-white px-5 py-10 sm:px-10 ${
            props.wide ? "lg:w-[620px] xl:w-[720px]" : "lg:w-[520px] xl:w-[580px]"
          }`}
        >
          <div className={`amb-fade-in mx-auto w-full ${props.wide ? "max-w-2xl" : "max-w-md"}`}>
            {props.steps && props.currentStep ? <Stepper steps={props.steps} current={props.currentStep} /> : null}
            {props.children}

            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-slate-100 pt-6">
              {[
                { icon: <IconShield />, label: "Secure & encrypted" },
                { icon: <IconCloud />, label: "Cloud based" },
                { icon: <IconMonitor />, label: "Access anywhere" },
              ].map((b) => (
                <span key={b.label} className="flex items-center gap-1.5 text-xs text-slate-600">
                  {b.icon}
                  {b.label}
                </span>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/** The title block every auth card starts with. */
export function AuthHeading({ title, subtitle, icon }: { title: string; subtitle?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-6 text-center">
      {icon && (
        <span
          aria-hidden="true"
          className="amb-pop-in mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"
        >
          {icon}
        </span>
      )}
      <h2 className="text-3xl font-extrabold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-2 text-sm text-slate-600">{subtitle}</p>}
    </div>
  );
}
