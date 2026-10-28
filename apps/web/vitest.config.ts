import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = { "@": path.resolve(import.meta.dirname, "./src") };
// Pure-logic unit tests don't touch a real database, but importing server modules still runs
// src/lib/env.ts's schema.parse — give it a placeholder so that doesn't throw.
const env = { DATABASE_URL: "postgresql://test:test@localhost:5432/amburax_test" };

export default defineConfig({
  resolve: { alias },
  test: {
    // Unit suites only. Integration tests live in src/test-integration and run under
    // vitest.integration.config.ts against a real database — they must never pick up the
    // placeholder DATABASE_URL above. The rendered till suite has its own config
    // (vitest.component.config.ts, `npm run test:component`).
    //
    // The guard reporter fails the run when a worker fails to start or a scheduled file never
    // ran; without it Vitest prints "N passed (N)" and the missing files are simply absent.
    reporters: ["default", "./vitest-support/workerStartGuard.ts"],
    testTimeout: 15000,
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/test/**/*.test.ts"],
          env,
          testTimeout: 15000,
          sequence: { groupOrder: 0 },
        },
      },
      {
        // Rendered component tests: `src/test/**/*.test.tsx` runs in jsdom, `*.test.ts` in node.
        // The file extension is the convention, so no per-file environment pragma is needed.
        // jsdom suites. Setting up jsdom is the slow part of these files; started alongside
        // ~15 node workers it regularly took longer than Vitest's 60 s worker-start timeout
        // ("Failed to start forks worker"). They now run as their own group after the node
        // files, with few workers, so they never compete with the main run for start-up time.
        resolve: { alias },
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/test/**/*.test.tsx"],
          env,
          testTimeout: 15000,
          maxWorkers: 2,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
