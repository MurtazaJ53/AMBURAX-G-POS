import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { getDataSecurityMetrics } from "@/server/identity/dataSecurityService";
import { PageHeader } from "../../../_components/ui";
import { SecurityNav } from "../SecurityNav";
import { DataSecurityClient } from "./DataSecurityClient";

export const metadata: Metadata = { title: "Data security — AMBURAX" };

export default async function DataSecurityPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (!session) redirect("/auth/login");

  const metrics = await getDataSecurityMetrics(session.tenantId);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Data security"
        subtitle="Cryptographic protection, persistent storage, and automated backups."
        breadcrumb={[
          { label: "Settings", href: "/settings" },
          { label: "Security", href: "/settings/security" },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <SecurityNav active="data" />
        <section className="space-y-6">
          <DataSecurityClient metrics={metrics} />
        </section>
      </div>
    </div>
  );
}
