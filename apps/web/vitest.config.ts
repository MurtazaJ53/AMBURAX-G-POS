import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Pure-logic unit tests don't touch a real database, but importing server modules
    // still runs src/lib/env.ts's schema.parse — give it a placeholder so that doesn't throw.
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/amburax_test",
    },
  },
});
