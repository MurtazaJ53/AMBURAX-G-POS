import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { PageHeader } from "../../_components/ui";
import { TerminalManager } from "./TerminalManager";

export default async function TerminalsPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("terminals: context resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/dashboard");

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <PageHeader
        title="POS Terminals"
        subtitle="Manage selling devices for your active store."
      />
      <div className="mt-8">
        <TerminalManager />
      </div>
    </div>
  );
}
