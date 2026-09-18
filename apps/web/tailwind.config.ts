import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /* Legacy AMBURAX (Do Not Remove) */
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
        /* New F1 Semantic Tokens */
        background: {
          app: "var(--color-bg-app)",
          card: "var(--color-bg-card)",
          subtle: "var(--color-bg-subtle)",
          hover: "var(--color-bg-hover)",
          active: "var(--color-bg-active)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          hover: "var(--color-border-hover)",
          focus: "var(--color-border-focus)",
        },
        primary: {
          DEFAULT: "var(--color-primary)",
          hover: "var(--color-primary-hover)",
          active: "var(--color-primary-active)",
          subtle: "var(--color-primary-subtle)",
        },
        success: {
          DEFAULT: "var(--color-success)",
          subtle: "var(--color-success-subtle)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
          subtle: "var(--color-warning-subtle)",
        },
        danger: {
          DEFAULT: "var(--color-danger)",
          subtle: "var(--color-danger-subtle)",
        },
        info: {
          DEFAULT: "var(--color-info)",
          subtle: "var(--color-info-subtle)",
        },
      },
      textColor: {
        primary: "var(--color-text-primary)",
        secondary: "var(--color-text-secondary)",
        tertiary: "var(--color-text-tertiary)",
        disabled: "var(--color-text-disabled)",
      },
      borderRadius: {
        amb: "var(--amb-radius-md)",
        "amb-sm": "var(--amb-radius-sm)",
        "amb-lg": "var(--amb-radius-lg)",
        /* New F1 Tokens */
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      boxShadow: {
        amb: "var(--amb-shadow-sm)",
        "amb-md": "var(--amb-shadow-md)",
        "amb-lg": "var(--amb-shadow-lg)",
        /* New F1 Tokens */
        subtle: "var(--shadow-subtle)",
        card: "var(--shadow-card)",
        dialog: "var(--shadow-dialog)",
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

