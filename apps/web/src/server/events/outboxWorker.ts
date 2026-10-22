import { pathToFileURL } from "node:url";
import { db } from "@/server/db";
import { logError } from "@/lib/safeLog";
import { NoEventTransportConfiguredError } from "@/server/events/publisher";
import {
  assertTransportConfigured,
  describeRunnerStartup,
  runOutboxWorker,
} from "@/server/events/outboxRunner";
import { TenantProvisioner } from "@/server/erp/tenantProvisioning";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Daily: every connected business gets its next financial year well before 1 April. */
function startFiscalYearRenewal(): () => void {
  const run = () =>
    new TenantProvisioner().renewFiscalYears().catch((err) => logError("fiscal year renewal failed", err, {}));
  void run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Standalone entry point for the outbox dispatcher. Run with `npm run outbox:work`.
 *
 * A separate process rather than anything attached to the web app, for three reasons that
 * are operational rather than stylistic:
 *
 *   - Lifetime. Next.js route handlers and server components are request-scoped and may be
 *     suspended or executed in a fresh isolate per request. A dispatch loop has to outlive
 *     a request.
 *   - Blast radius. A transport outage should slow event delivery, not a customer's
 *     checkout. Nothing on the sale path waits on this process.
 *   - Scale. Dispatchers should scale with event volume, deliberately, rather than with
 *     HTTP traffic by accident. `FOR UPDATE SKIP LOCKED` makes running N of these safe.
 *
 * Exit codes are meaningful, because a supervisor reads them:
 *   0  clean shutdown after SIGINT/SIGTERM
 *   1  the loop died for a reason that is not a configuration problem
 *   78 no transport configured (EX_CONFIG) — the expected state today, and deliberately not
 *      exit 0: the process did not do the job it was asked to do.
 */

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
/** sysexits.h EX_CONFIG. Distinguishable from a crash by any supervisor or CI step. */
export const EXIT_NO_TRANSPORT = 78;

export async function main(): Promise<number> {
  let transport;
  try {
    transport = assertTransportConfigured();
  } catch (err) {
    if (err instanceof NoEventTransportConfiguredError) {
      // Not routed through logError: this is a configuration statement for a human, not an
      // incident, and it must be readable at a glance in a terminal or supervisor log.
      console.error(
        JSON.stringify({
          level: "error",
          scope: "outbox runner: refusing to start",
          reason: err.message,
          consequence:
            "No events were claimed. Existing events remain PENDING and are not marked published.",
        }),
      );
      return EXIT_NO_TRANSPORT;
    }
    throw err;
  }

  console.log(describeRunnerStartup(transport));

  // Graceful shutdown: the abort stops the loop at the next safe point and the in-flight
  // pass is allowed to finish. Nothing is lost either way — an event claimed but not
  // published simply becomes due again after its backoff.
  const controller = new AbortController();
  let shuttingDown = false;
  const stop = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ level: "info", scope: "outbox runner: stopping", signal }));
    controller.abort();
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  const stopRenewal = startFiscalYearRenewal();
  try {
    const summary = await runOutboxWorker({ signal: controller.signal });
    console.log(JSON.stringify({ level: "info", scope: "outbox runner: stopped", ...summary }));
    return EXIT_OK;
  } catch (err) {
    logError("outbox runner: terminated", err, {});
    return EXIT_FAILED;
  } finally {
    stopRenewal();
    // The worker owns its process, so it owns the connection pool's shutdown too.
    await db.$disconnect().catch(() => {});
  }
}

/**
 * Only run when executed directly. Importing this module — which the tests do, to check the
 * exit codes — must not start a dispatch loop.
 */
const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      logError("outbox runner: unhandled failure", err, {});
      process.exitCode = EXIT_FAILED;
    });
}
