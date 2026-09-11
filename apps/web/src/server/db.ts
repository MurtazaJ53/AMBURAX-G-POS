import { PrismaClient } from "@prisma/client";

declare global {
  // `var` is required here: this is the only declaration form that augments globalThis.
  // (The previous eslint-disable for `no-var` is gone — typescript-eslint does not flag
  // ambient declarations, so the directive was dead.)
  var __prisma: PrismaClient | undefined;
}

export const db = globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = db;
}
