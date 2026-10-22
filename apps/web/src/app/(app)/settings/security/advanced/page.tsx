import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { getAdvancedSecuritySettings } from "@/server/identity/advancedSecurityService";
import { PageHeader } from "../../../_components/ui";
import { SecurityNav } from "../SecurityNav";
import { AdvancedSecurityClient } from "./AdvancedSecurityClient";

export const metadata: Metadata = { title: "Advanced security — AMBURAX" };

export default async function AdvancedSecurityPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const session = token ? await resolveSession(token) : null;
  if (!session) redirect("/auth/login");

  const settings = await getAdvancedSecuritySettings(session.tenantId);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Advanced security"
        subtitle="Network fencing, device pairing policies, and store operational parameters."
        breadcrumb={[
          { label: "Settings", href: "/settings" },
          { label: "Security", href: "/settings/security" },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <SecurityNav active="advanced" />
        <section className="space-y-6">
          <AdvancedSecurityClient settings={settings} />
        </section>
      </div>
    </div>
  );
}
