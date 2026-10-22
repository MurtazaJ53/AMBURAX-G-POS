import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext } from "@/server/sales/posContext";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import Link from "next/link";
import { MonitorSmartphone } from "lucide-react";
import { PageHeader, buttonClass } from "../../_components/ui";
import { TerminalManager } from "./TerminalManager";

import { PrinterTestBench } from "@/client/hardware/PrinterTestBench";

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
        title="POS Terminals & Hardware"
        subtitle="Manage selling devices, direct ESC/POS thermal printers, and cash drawers for your active store."
        actions={
          <Link href="/till" className={`${buttonClass("primary")} amb-press`}>
            <MonitorSmartphone aria-hidden="true" className="h-4 w-4" />
            Open Till
          </Link>
        }
      />
      <p className="mt-2 text-sm text-slate-600">
        Open the Till on the counter computer. The first time, an owner or store manager clicks “Use this computer as …” there to set it up.
      </p>
      
      <div className="mt-6">
        <PrinterTestBench />
      </div>

      <div className="mt-8">
        <TerminalManager />
      </div>
    </div>
  );
}
