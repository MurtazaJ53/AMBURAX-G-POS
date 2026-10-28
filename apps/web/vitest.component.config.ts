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

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The workspace has exactly one React (19, hoisted to the root `node_modules`), so no
    // React aliasing is needed; `dedupe` below guards against a second copy creeping back.
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
    ],
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    include: ["src/test-component/**/*.test.tsx"],
    setupFiles: ["./src/test-component/setup.ts"],
    globals: true,
    // Inlined so these packages go through Vite and pick up the `next/*` stubs above.
    server: {
      deps: {
        inline: [/@testing-library\//, /@radix-ui\//, /lucide-react/],
      },
    },
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/amburax_test",
    },
    testTimeout: 15000,
  },
});

