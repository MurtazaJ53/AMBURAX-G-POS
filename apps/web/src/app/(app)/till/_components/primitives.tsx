"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * The till's controls.
 *
 * Separate from the workspace UI kit, and not a fork of it. A workspace screen is read by
 * someone sitting down with a mouse; a till is operated at speed by someone whose eyes are on
 * the customer. That changes the primitives rather than merely their colours: every target is
 * at least 44px, every action states its keyboard shortcut, and nothing depends on hover to be
 * discoverable. They share the platform tokens, which is what keeps the two surfaces one
 * product.
 */

type Tone = "accent" | "neutral" | "critical" | "ghost" | "inverse";
type Size = "md" | "lg";

const TONE: Record<Tone, string> = {
  accent:
    "bg-amb-accent text-amb-accent-ink hover:bg-amb-accent-hover disabled:bg-amb-line-strong disabled:text-amb-ink-muted",
  neutral:
    "bg-amb-raised text-amb-ink border border-amb-line-strong hover:bg-amb-sunken disabled:text-amb-ink-muted",
  critical:
    "bg-amb-critical-soft text-amb-critical border border-amb-critical/30 hover:bg-amb-critical hover:text-white",
  ghost: "text-amb-ink-secondary hover:bg-amb-sunken hover:text-amb-ink",
  inverse:
    "bg-amb-inverse-raised text-amb-ink-inverse border border-amb-line-inverse hover:bg-amb-line-inverse",
};

const SIZE: Record<Size, string> = {
  md: "min-h-touch px-4 text-sm",
  lg: "min-h-[3.5rem] px-6 text-base",
};

export function Button({
  tone = "neutral",
  size = "md",
  shortcut,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone;
  size?: Size;
  /** Rendered beside the label, not hidden in a tooltip — a shortcut nobody can see is not one. */
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-amb font-semibold transition-colors disabled:cursor-not-allowed ${TONE[tone]} ${SIZE[size]} ${className ?? ""}`}
    >
      <span>{children}</span>
      {shortcut && <Kbd tone={tone === "accent" ? "onAccent" : "default"}>{shortcut}</Kbd>}
    </button>
  );
}

/**
 * A keyboard hint.
 *
 * `aria-hidden` because it is a visual reminder of a shortcut, not part of the control's name —
 * a screen reader announcing "Take payment F2" reads the shortcut as if it were the label. The
 * shortcuts themselves are listed once, in a real region, by `ShortcutLegend`.
 */
export function Kbd({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "onAccent" | "inverse";
}) {
  const style =
    tone === "onAccent"
      ? "border-white/40 bg-white/15 text-white"
      : tone === "inverse"
        ? "border-amb-line-inverse bg-amb-inverse text-amb-ink-inverse-muted"
        : "border-amb-line-strong bg-amb-sunken text-amb-ink-secondary";
  return (
    <kbd
      aria-hidden="true"
      className={`rounded-amb-sm border px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold leading-none ${style}`}
    >
      {children}
    </kbd>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col rounded-amb-lg border border-amb-line bg-amb-raised shadow-amb ${className ?? ""}`}
    >
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-amb-line px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amb-ink-muted">
            {title}
          </h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const CHIP: Record<string, string> = {
  neutral: "bg-amb-sunken text-amb-ink-secondary",
  positive: "bg-amb-positive-soft text-amb-positive",
  caution: "bg-amb-caution-soft text-amb-caution",
  critical: "bg-amb-critical-soft text-amb-critical",
  info: "bg-amb-info-soft text-amb-info",
  accent: "bg-amb-accent-soft text-amb-accent",
};

export function Chip({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof CHIP;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${CHIP[tone]}`}
    >
      {children}
    </span>
  );
}

/** A labelled value. The label is real text, not a placeholder that vanishes when typed into. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-amb-ink-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-amb-ink-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full min-h-touch rounded-amb border border-amb-line-strong bg-amb-raised px-3 text-base text-amb-ink placeholder:text-amb-ink-muted";
