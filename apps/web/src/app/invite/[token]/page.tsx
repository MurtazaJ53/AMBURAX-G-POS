import type { Metadata } from "next";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { previewInvitation } from "@/server/tenant/invitation";
import { AcceptInvitationForm } from "./AcceptInvitationForm";
import { logError } from "@/lib/safeLog";

export const metadata: Metadata = {
  title: "You're invited — AMBURAX POS",
};

const ROLE_LABELS: Record<string, string> = {
  STORE_MANAGER: "Store Manager",
  SALES_ASSOCIATE: "Sales Associate",
  CASHIER: "Cashier",
  INVENTORY_MANAGER: "Inventory Manager",
  ACCOUNTANT: "Accountant",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-slate-950 p-12 text-white lg:flex">
        <div className="text-lg font-semibold tracking-tight">AMBURAX POS</div>
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold leading-tight text-white">Join your team.</h1>
          <p className="text-sm text-slate-300">
            One system for the counter, stock, and everything in between.
          </p>
        </div>
        <p className="text-xs text-slate-400">Trusted by garment and general retail businesses.</p>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="text-lg font-semibold tracking-tight text-slate-900">AMBURAX POS</div>
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}

function DeadEnd({ title, body, cta }: { title: string; body: string; cta: "login" | "none" }) {
  return (
    <Shell>
      <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
      <div role="alert" className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {body}
      </div>
      {cta === "login" && (
        <a
          href="/auth/login"
          className="mt-4 block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          Sign in
        </a>
      )}
    </Shell>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Resolved server-side: the raw token never has to reach the client for the *preview*,
  // and nothing about tenant/store internal ids is exposed — only display names.
  // Wrapped because a datastore outage on a public, unauthenticated page must degrade to
  // a readable message, not Next's generic 500 — matching how every API route here behaves.
  let preview: Awaited<ReturnType<typeof previewInvitation>>;
  try {
    preview = await previewInvitation(token);
  } catch (err) {
    logError("invite: preview failed", err);
    return (
      <DeadEnd
        title="Temporarily unavailable"
        body="We couldn't load this invitation right now. Please try again in a few minutes."
        cta="none"
      />
    );
  }

  if (preview.status === "invalid") {
    return (
      <DeadEnd
        title="Invitation not found"
        body="This invitation link isn't valid. Ask whoever invited you to send a new one."
        cta="none"
      />
    );
  }
  if (preview.status === "EXPIRED") {
    return (
      <DeadEnd
        title="Invitation expired"
        body="This invitation has expired. Ask whoever invited you to send a new one."
        cta="none"
      />
    );
  }
  if (preview.status === "REVOKED") {
    return (
      <DeadEnd title="Invitation cancelled" body="This invitation was cancelled by the business." cta="none" />
    );
  }
  if (preview.status === "ACCEPTED") {
    return (
      <DeadEnd
        title="Already accepted"
        body="This invitation has already been used. Sign in to reach your workspace."
        cta="login"
      />
    );
  }

  // A failure here degrades to "not signed in", which is the safe default: the visitor
  // sees the sign-in-first panel, and the server still enforces every rule on submit.
  let signedInAs: string | null = null;
  try {
    const sessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
    const session = sessionToken ? await resolveSession(sessionToken) : null;
    signedInAs = session?.user.email ?? null;
  } catch (err) {
    logError("invite: session resolution failed", err);
  }

  return (
    <Shell>
      <h2 className="text-2xl font-semibold text-slate-900">You&apos;re invited</h2>
      <p className="mt-1 text-sm text-slate-500">
        <span className="font-medium text-slate-700">{preview.tenantName}</span> invited you to join{" "}
        <span className="font-medium text-slate-700">{preview.storeName}</span> as{" "}
        <span className="font-medium text-slate-700">{ROLE_LABELS[preview.role] ?? preview.role}</span>.
      </p>
      <AcceptInvitationForm
        token={token}
        email={preview.email}
        accountExists={preview.accountExists}
        signedInAs={signedInAs}
      />
    </Shell>
  );
}
