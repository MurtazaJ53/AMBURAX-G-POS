import { Prisma } from "@prisma/client";

/**
 * True for errors that mean "the database could not be reached", where nothing ran on the
 * server, so running the same work again cannot double-apply it.
 * P1001 can't reach server, P1002 timed out reaching it, P1017 server closed the connection
 * before the query; an initialization error is the client failing to connect at all.
 */
export function isDbConnectionError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) return ["P1001", "P1002", "P1017"].includes(err.code);
  return false;
}

/** Runs `work`; on a connection error waits briefly and tries exactly once more. */
export async function withDbConnectionRetry<T>(work: () => Promise<T>, delayMs = 300): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (!isDbConnectionError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return work();
  }
}
