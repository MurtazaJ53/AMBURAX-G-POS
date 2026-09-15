import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /**
         * The AMBURAX platform palette, bound to the tokens in src/design/tokens.css.
         *
         * Every value is a CSS variable rather than a literal, so one file decides what the
         * product looks like and a capability surface added later inherits it for free. The
         * variables are declared under `[data-amburax]`, so these classes only resolve inside
         * a surface that opts in — which is why the existing workspace screens are unaffected.
         */
        amb: {
          surface: "var(--amb-surface-base)",
          raised: "var(--amb-surface-raised)",
          sunken: "var(--amb-surface-sunken)",
          inverse: "var(--amb-surface-inverse)",
          "inverse-raised": "var(--amb-surface-inverse-raised)",
          ink: "var(--amb-ink-primary)",
          "ink-secondary": "var(--amb-ink-secondary)",
          "ink-muted": "var(--amb-ink-muted)",
          "ink-inverse": "var(--amb-ink-inverse)",
          "ink-inverse-muted": "var(--amb-ink-inverse-muted)",
          line: "var(--amb-line)",
          "line-strong": "var(--amb-line-strong)",
          "line-inverse": "var(--amb-line-inverse)",
          accent: "var(--amb-accent)",
          "accent-hover": "var(--amb-accent-hover)",
          "accent-ink": "var(--amb-accent-ink)",
          "accent-soft": "var(--amb-accent-soft)",
          positive: "var(--amb-positive)",
          "positive-soft": "var(--amb-positive-soft)",
          caution: "var(--amb-caution)",
          "caution-soft": "var(--amb-caution-soft)",
          critical: "var(--amb-critical)",
          "critical-soft": "var(--amb-critical-soft)",
          info: "var(--amb-info)",
          "info-soft": "var(--amb-info-soft)",
        },
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af",
        },
      },
      borderRadius: {
        amb: "var(--amb-radius-md)",
        "amb-sm": "var(--amb-radius-sm)",
        "amb-lg": "var(--amb-radius-lg)",
      },
      boxShadow: {
        amb: "var(--amb-shadow-sm)",
        "amb-md": "var(--amb-shadow-md)",
        "amb-lg": "var(--amb-shadow-lg)",
      },
      minHeight: {
        touch: "var(--amb-touch)",
        row: "var(--amb-row)",
      },
    },
  },
  plugins: [],
};

export default config;
