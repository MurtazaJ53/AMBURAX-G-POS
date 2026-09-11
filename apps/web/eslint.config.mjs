import next from "eslint-config-next/core-web-vitals";

/**
 * Flat config (ESLint 9). Closes audit finding P1-6.
 *
 * Next.js 16 removed the `next lint` command, and this project had no ESLint
 * configuration of any kind — `npm run lint` had never worked, so roughly seventy-five
 * source files had never been statically analysed.
 *
 * `eslint-config-next/core-web-vitals` is deliberately the only import. It is the superset
 * of the other two entry points (it composes `next` + `next/typescript` + the Core Web
 * Vitals rules) and it already bundles typescript-eslint, eslint-plugin-react,
 * react-hooks, jsx-a11y and @next/eslint-plugin-next. Adding plugins on top of it would be
 * duplicated configuration, not extra coverage.
 */
const config = [
  {
    // Build output and generated declarations only. Nothing under src/ or prisma/ is
    // excluded — API routes, server code, auth, onboarding, database utilities, components
    // and pages are all linted.
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "*.tsbuildinfo"],
  },
  ...next,
];

export default config;
