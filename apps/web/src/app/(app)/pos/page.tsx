import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { PosTerminal } from "./PosTerminal";
import { PermissionDeniedState } from "../_components/ui";

/**
 * The till.
 *
 * Authorization is decided here, on the server, before any of the terminal is sent to the
 * browser: a user who may not sell never receives the selling UI at all. The API re-checks
 * the same thing on every request regardless — this guard is for the operator's clarity,
 * not for security.
 *
 * Renders inside the (app) shell, so the persistent sidebar and top bar remain visible
 * around the till, matching the design reference.
 */
export default async function PosPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  // Only the data load is wrapped. redirect() below is implemented by throwing, so
  // catching around it would swallow the navigation.
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("pos: context resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") {
    redirect("/auth/login");
  }

  // A tenant with no store has not finished onboarding. /home owns that decision, so send
  // the user there rather than duplicating the resume logic in a second place.
  if (resolved.status === "no_store") {
    redirect("/home");
  }

  const context = resolved.context;

  if (!context.canSell) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <PermissionDeniedState
          title="You can't sell in this store"
          description={`Your role in ${context.storeName} doesn't include taking payments. Ask an owner or store manager to change your access.`}
          hint={`Signed in as ${context.userName} · ${context.membershipRole ?? "no store role"}`}
        />
      </div>
    );
  }

  return (
    <PosTerminal
      storeName={context.storeName}
      storeCode={context.storeCode}
      cashierName={context.userName}
    />
  );
}
