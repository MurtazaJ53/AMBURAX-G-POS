import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Component tests — the till's critical path, rendered.
 *
 * A third config rather than a flag on an existing one, for the same reason there are already
 * two: `vitest.config.ts` runs in a node environment and injects a fake `DATABASE_URL` so pure
 * logic can import server modules, and `vitest.integration.config.ts` runs against a real
 * database. Neither posture is right for a DOM suite, and cross-wiring them is how a component
 * test ends up talking to Postgres.
 *
 * Nothing here reaches a network or a database. Every test stubs `fetch` with the exact
 * envelopes the v1 routes return, which is what makes them fast and what makes them honest:
 * a component test that invented its own response shape would pass while the real screen broke.
 */
/** Vite alias replacements are joined as URLs, so Windows separators have to go. */
function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/**
 * This package's own React.
 *
 * The repository is an npm workspace and an unrelated root dependency pulls React 18 into the
 * hoisted `node_modules`. Testing Library resolves from there, which would render this app's
 * React 19 tree with React DOM 18 and fail in a way that reads as a component bug rather than
 * a resolution one.
 */
const LOCAL_REACT = toPosix(path.resolve(import.meta.dirname, "./node_modules/react"));
const LOCAL_REACT_DOM = toPosix(path.resolve(import.meta.dirname, "./node_modules/react-dom"));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Array form, because the subpaths matter. Testing Library imports `react-dom/client` and
    // the JSX transform imports `react/jsx-runtime`; an alias keyed on the bare package name
    // does not match either, so half the tree would still resolve to the hoisted copy.
    alias: [
      { find: /^@\/(.*)$/, replacement: `${toPosix(path.resolve(import.meta.dirname, "./src"))}/$1` },
      // `next/link` reads the App Router context, which exists only inside a running Next
      // tree. Swapped for a plain anchor so a component that links anywhere is testable; what
      // these tests assert about a link — its accessible name and its href — an anchor carries.
      {
        find: /^next\/link$/,
        replacement: toPosix(path.resolve(import.meta.dirname, "./src/test-component/nextLinkStub.tsx")),
      },
      {
        find: /^next\/navigation$/,
        replacement: toPosix(
          path.resolve(import.meta.dirname, "./src/test-component/nextNavigationStub.ts"),
        ),
      },
      { find: /^react$/, replacement: LOCAL_REACT },
      { find: /^react\/(.*)$/, replacement: `${LOCAL_REACT}/$1` },
      { find: /^react-dom$/, replacement: LOCAL_REACT_DOM },
      { find: /^react-dom\/(.*)$/, replacement: `${LOCAL_REACT_DOM}/$1` },
    ],
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    include: ["src/test-component/**/*.test.tsx"],
    setupFiles: ["./src/test-component/setup.ts"],
    globals: true,
    // Testing Library lives in the hoisted workspace `node_modules`, and Vitest externalises
    // anything there — it is loaded by Node's resolver, which never sees the aliases above.
    // Inlining it puts it back through Vite, so it picks up this package's React rather than
    // the hoisted React 18.
    server: {
      deps: {
        inline: [/@testing-library\//],
      },
    },
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/amburax_test",
    },
  },
});
