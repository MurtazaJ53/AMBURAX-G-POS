import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Users } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { db } from "@/server/db";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { deriveInvitationStatus } from "@/server/tenant/invitation";
import { INVITABLE_STORE_ROLES } from "@/server/tenant/storeRoles";
import { buttonClass, DataTable, EmptyState, PageHeader, PermissionDeniedState, StatusBadge, Td, Th } from "../_components/ui";
import { formatDateTime } from "../sales/formatDateTime";
import { InvitationActions, InviteStaffForm, StaffPinControl, StaffActions } from "./StaffClient";
import { ROLE_LABEL } from "./roleLabels";

/**
 * Staff (screen 50): who works in the current store, in which role, and pending invitations.
 * Owner only, as PERMISSIONS.md has it for invitations; attendance and shifts are separate screens.
 */
export default async function StaffPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("staff: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  if (ctx.tenantRole !== "OWNER") {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Staff" />
        <PermissionDeniedState
          title="Staff is managed by the owner"
          description="Only the business owner can see the team and invite people."
        />
        <div className="mt-4 flex justify-center gap-2">
          <Link href="/staff/attendance" className={buttonClass("primary")}>
            Your attendance
          </Link>
          <Link href="/staff/leave" className={buttonClass("secondary")}>
            Leave
          </Link>
          {ctx.membershipRole === "STORE_MANAGER" && (
            <Link href="/staff/shifts" className={buttonClass("secondary")}>
              Shifts
            </Link>
          )}
        </div>
      </div>
    );
  }

  let data;
  try {
    const [members, invitations] = await Promise.all([
      db.storeMembership.findMany({
        where: { tenantId: ctx.tenantId, storeId: ctx.storeId },
        orderBy: { user: { name: "asc" } },
        select: {
          role: true,
          user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true, tenantRole: true, approvalPinHash: true } },
        },
      }),
      db.invitation.findMany({
        where: { tenantId: ctx.tenantId, storeId: ctx.storeId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    data = { members, pending: invitations.filter((i) => deriveInvitationStatus(i) === "PENDING") };
  } catch (err) {
    logError("staff: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  const { members, pending } = data;

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Staff"
        subtitle={`${members.length} ${members.length === 1 ? "person works" : "people work"} in ${ctx.storeName}.`}
        actions={
          <div className="flex flex-wrap items-start gap-2">
            <Link href="/staff/attendance" className={buttonClass("secondary")}>
              Attendance
            </Link>
            <Link href="/staff/shifts" className={buttonClass("secondary")}>
              Shifts
            </Link>
            <Link href="/staff/leave" className={buttonClass("secondary")}>
              Leave
            </Link>
            <InviteStaffForm storeId={ctx.storeId} roles={INVITABLE_STORE_ROLES} />
          </div>
        }
      />

      {members.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="No one in this store yet"
            description="Invite your team to get started."
          />
        </div>
      ) : (
        <DataTable caption="Team in this store">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Last sign-in</Th>
              <Th>Status</Th>
              <Th>Till PIN</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user.id}>
                <Td>
                  <span className="font-medium text-slate-900">{m.user.name}</span>
                  <span className="block text-xs text-slate-500">{m.user.email}</span>
                </Td>
                <Td>{ROLE_LABEL[m.role] ?? m.role}</Td>
                <Td>{m.user.lastLoginAt ? formatDateTime(m.user.lastLoginAt) : "Never"}</Td>
                <Td>
                  <StatusBadge tone={m.user.status === "ACTIVE" ? "success" : "neutral"}>
                    {m.user.status === "ACTIVE" ? "Active" : "Disabled"}
                  </StatusBadge>
                </Td>
                <Td>
                  <StaffPinControl
                    userId={m.user.id}
                    name={m.user.name}
                    hasPin={Boolean(m.user.approvalPinHash)}
                    isOwnerRow={m.user.tenantRole === "OWNER"}
                    isSelf={m.user.id === ctx.userId}
                  />
                </Td>
                <Td align="right">
                  <StaffActions
                    userId={m.user.id}
                    name={m.user.name}
                    currentRole={m.role}
                    isOwnerRow={m.user.tenantRole === "OWNER"}
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <h2 className="mb-3 mt-8 text-base font-semibold text-slate-900">Pending invitations</h2>
      {pending.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600">No pending invitations.</p>
      ) : (
        <DataTable caption="Pending invitations">
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Expires</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {pending.map((i) => (
              <tr key={i.id}>
                <Td>{i.email}</Td>
                <Td>{ROLE_LABEL[i.role] ?? i.role}</Td>
                <Td>{formatDateTime(i.expiresAt)}</Td>
                <Td align="right">
                  <InvitationActions id={i.id} email={i.email} />
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
