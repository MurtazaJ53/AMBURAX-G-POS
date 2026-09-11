import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { resolveInvitation, previewInvitation } from "@/server/tenant/invitation";
import { isInvitableStoreRole } from "@/server/tenant/storeRoles";
import { hashPassword } from "@/server/identity/password";
import { validatePasswordStrength } from "@/server/identity/passwordPolicy";
import { createSession, resolveSession } from "@/server/identity/session";
import { isIpRateLimited, recordAttempt } from "@/server/identity/loginGuard";
import { writeAuditLog } from "@/server/identity/audit";

export interface AcceptInvitationInput {
  token: string;
  /** Only used on the new-account path; ignored entirely when the invited email already has an account. */
  name?: string;
  password?: string;
  /** The visitor's current session cookie, if any. Required for the existing-account path. */
  sessionToken?: string;
  ip: string;
  userAgent: string | null;
  correlationId: string;
}

export type AcceptInvitationResult =
  | { status: "rate_limited" }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "revoked" }
  | { status: "already_accepted" }
  | { status: "identity_mismatch" }
  | { status: "identity_conflict" }
  | { status: "account_disabled" }
  | { status: "login_required"; email: string }
  | { status: "weak_password"; reason: string }
  | { status: "validation_error"; reason: string }
  | { status: "already_member" }
  | {
      status: "ok";
      /** Only set on the new-account path — an existing user keeps the session they already had. */
      sessionToken?: string;
      expiresAt?: string;
      user: { id: string; name: string; email: string };
      tenant: { name: string };
      store: { name: string };
      role: string;
    };

/** Thrown inside the transaction when a concurrent acceptance already claimed this invitation. */
class InvitationAlreadyClaimedError extends Error {}
/** Thrown inside the transaction when the invited user vanished/changed underneath us. */
class InvitationIdentityConflictError extends Error {}

function isUniqueViolation(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta!.target as string[]).includes(field)
  );
}

/**
 * A11 — turns an A8 invitation into real access. Two paths, one transaction shape.
 *
 * NEW ACCOUNT: the invitation authorizes creating a User for exactly the invited email
 * (never a client-supplied one). The visitor sets their own password, so a session is
 * issued on success — the same reasoning as A6 (ADR-043): this is account creation, and
 * possession of an emailed link is the same class of identity proof A3/A4 already rely on.
 *
 * EXISTING ACCOUNT: A11 deliberately does NOT accept a password and NEVER mints a session.
 * The visitor must already hold a session for that exact email. Verifying a password here
 * would mean re-implementing A1's login — including its MFA branch, lockout, and timing
 * defenses — and any divergence would turn an invitation link into an MFA bypass for an
 * existing account. Reusing A1/A2 wholesale is the only safe option. See DECISIONS.md.
 *
 * TRANSACTION ORDER — claim first, deliberately:
 *   1. Conditional `updateMany` claim on the invitation (the only statement that can lose
 *      a race). A loser matches zero rows and aborts before writing anything at all.
 *   2. Create-or-load the User.
 *   3. Bind `acceptedByUserId` to that user.
 *   4. Create the StoreMembership (its @@unique([userId, storeId]) is the final net).
 * Claiming first means the invitation row is locked for the whole transaction, so a
 * concurrent acceptance blocks and then fails cleanly rather than doing user-creation work
 * that must be rolled back — and, critically, nothing (User, membership, acceptedBy) can
 * ever outlive a failed claim, because all four statements share one transaction.
 * Session creation is intentionally OUTSIDE the transaction (A6 precedent): a transient
 * session-write failure must not roll back an otherwise-valid acceptance — the user can
 * simply sign in.
 */
export async function acceptInvitation(input: AcceptInvitationInput): Promise<AcceptInvitationResult> {
  if (
    await isIpRateLimited(input.ip, "invitation_accept", {
      windowMs: 60 * 60 * 1000,
      threshold: env.INVITATION_ACCEPT_MAX_PER_WINDOW,
    })
  ) {
    return { status: "rate_limited" };
  }

  const invitation = await resolveInvitation(input.token);
  if (!invitation) {
    // Tell the token holder *why* it isn't acceptable, via the same single lookup.
    // Safe for a holder of a 256-bit token; see previewInvitation's note in invitation.ts.
    const preview = await previewInvitation(input.token);
    if (preview.status === "EXPIRED") return { status: "expired" };
    if (preview.status === "REVOKED") return { status: "revoked" };
    if (preview.status === "ACCEPTED") return { status: "already_accepted" };
    return { status: "invalid" };
  }

  // The invitation — not the browser — is authoritative for tenant, store, email and role.
  // Re-validate the role at acceptance too: an allow-list that changed since A8 issued the
  // invitation must not be bypassed by an old row.
  if (!isInvitableStoreRole(invitation.role)) {
    await writeAuditLog({
      tenantId: invitation.tenantId,
      action: "InvitationAcceptRejected",
      correlationId: input.correlationId,
      metadata: { invitationId: invitation.id, reason: "role_no_longer_invitable" },
    });
    return { status: "invalid" };
  }

  const existingUser = await db.user.findUnique({ where: { email: invitation.email } });

  // An authenticated visitor may only ever accept an invitation addressed to their own
  // email. This is what stops "invitation for alice@ + logged-in Bob -> Bob gets Alice's
  // membership", and also prevents a confusing silent session swap on the new-account path.
  const currentSession = input.sessionToken ? await resolveSession(input.sessionToken) : null;
  if (currentSession && currentSession.user.email !== invitation.email) {
    await writeAuditLog({
      tenantId: invitation.tenantId,
      userId: currentSession.userId,
      action: "InvitationAcceptRejected",
      correlationId: input.correlationId,
      metadata: { invitationId: invitation.id, reason: "identity_mismatch" },
    });
    return { status: "identity_mismatch" };
  }

  let passwordHash: string | null = null;

  if (existingUser) {
    // A8 blocks inviting an email owned by another tenant, but that check ran when the
    // invitation was created — the account could have been created since. The database is
    // the authority at acceptance time, not A8's earlier snapshot.
    if (existingUser.tenantId !== invitation.tenantId) {
      return { status: "identity_conflict" };
    }
    if (existingUser.status === "DISABLED") {
      return { status: "account_disabled" };
    }
    // Existing account: identity must be proven by a real session, never by the token.
    if (!currentSession) {
      return { status: "login_required", email: invitation.email };
    }
  } else {
    if (!input.name || input.name.trim().length < 2) {
      return { status: "validation_error", reason: "Enter your full name." };
    }
    if (!input.password) {
      return { status: "validation_error", reason: "Choose a password." };
    }
    const strength = validatePasswordStrength(input.password);
    if (!strength.ok) {
      return { status: "weak_password", reason: strength.reason };
    }
    passwordHash = await hashPassword(input.password);
  }

  try {
    const user = await db.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new InvitationAlreadyClaimedError();
      }

      const accepting = existingUser
        ? await tx.user.findUnique({ where: { id: existingUser.id } })
        : await tx.user.create({
            data: {
              tenantId: invitation.tenantId,
              email: invitation.email,
              passwordHash: passwordHash!,
              name: input.name!.trim(),
              // Invited members are always tenant-level STAFF. Tenant ownership is
              // established exactly once, at A6 — never through an invitation.
              tenantRole: "STAFF",
            },
          });

      if (!accepting) {
        throw new InvitationIdentityConflictError();
      }

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedByUserId: accepting.id },
      });

      await tx.storeMembership.create({
        data: { userId: accepting.id, storeId: invitation.storeId, role: invitation.role },
      });

      return accepting;
    });

    // Outside the transaction on purpose (see the doc comment above). Only the new-account
    // path gets a session — an existing account already had one, and minting a second from
    // token possession would be the account-takeover path this screen exists to prevent.
    let session: { token: string; expiresAt: Date } | null = null;
    if (!existingUser) {
      session = await createSession({
        userId: user.id,
        tenantId: invitation.tenantId,
        ip: input.ip,
        userAgent: input.userAgent,
      });
      await writeAuditLog({
        tenantId: invitation.tenantId,
        userId: user.id,
        action: "UserCreatedFromInvitation",
        correlationId: input.correlationId,
        metadata: { invitationId: invitation.id },
      });
    } else {
      await writeAuditLog({
        tenantId: invitation.tenantId,
        userId: user.id,
        action: "ExistingUserLinkedFromInvitation",
        correlationId: input.correlationId,
        metadata: { invitationId: invitation.id },
      });
    }

    await recordAttempt({ email: invitation.email, ip: input.ip, success: true, context: "invitation_accept" });
    await writeAuditLog({
      tenantId: invitation.tenantId,
      userId: user.id,
      action: "InvitationAccepted",
      correlationId: input.correlationId,
      metadata: { invitationId: invitation.id, storeId: invitation.storeId, role: invitation.role },
    });
    await writeAuditLog({
      tenantId: invitation.tenantId,
      userId: user.id,
      action: "StoreMembershipCreated",
      correlationId: input.correlationId,
      metadata: { storeId: invitation.storeId, role: invitation.role },
    });

    return {
      status: "ok",
      ...(session ? { sessionToken: session.token, expiresAt: session.expiresAt.toISOString() } : {}),
      user: { id: user.id, name: user.name, email: user.email },
      tenant: { name: invitation.tenant.name },
      store: { name: invitation.store.name },
      role: invitation.role,
    };
  } catch (err) {
    if (err instanceof InvitationAlreadyClaimedError) {
      await recordAttempt({
        email: invitation.email,
        ip: input.ip,
        success: false,
        reason: "lost_accept_race",
        context: "invitation_accept",
      });
      return { status: "already_accepted" };
    }
    if (err instanceof InvitationIdentityConflictError) {
      return { status: "identity_conflict" };
    }
    if (isUniqueViolation(err, "userId") || isUniqueViolation(err, "storeId")) {
      // StoreMembership's @@unique([userId, storeId]) as the final safety net — the whole
      // transaction (including the claim) rolled back, so the invitation stays acceptable.
      return { status: "already_member" };
    }
    if (isUniqueViolation(err, "email")) {
      // A concurrent signup took this email between our read and the insert.
      return { status: "identity_conflict" };
    }
    throw err;
  }
}
