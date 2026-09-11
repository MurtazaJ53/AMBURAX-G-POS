import { db } from "@/server/db";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/identity/token";
import { isInvitableStoreRole } from "@/server/tenant/storeRoles";
import { identityNotifier } from "@/server/identity/notifier";
import { isIpRateLimited, recordAttempt } from "@/server/identity/loginGuard";
import { writeAuditLog } from "@/server/identity/audit";

/** Derived, never stored — one source of truth per fact (acceptedAt/revokedAt/expiresAt), see schema.prisma. */
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export function deriveInvitationStatus(inv: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): InvitationStatus {
  if (inv.acceptedAt) return "ACCEPTED";
  if (inv.revokedAt) return "REVOKED";
  if (inv.expiresAt.getTime() < Date.now()) return "EXPIRED";
  return "PENDING";
}

function inviteUrl(token: string): string {
  return `${env.APP_BASE_URL}/invite/${token}`;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateInvitationInput {
  sessionToken: string;
  storeId: string;
  email: string;
  role: string;
  ip: string;
  correlationId: string;
}

export type CreateInvitationResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited" }
  | { status: "invalid_role" }
  | { status: "invalid_store" }
  | { status: "email_unavailable" }
  | { status: "already_member" }
  | {
      status: "ok";
      invitation: { id: string; email: string; role: string; storeId: string; expiresAt: string };
      devInviteLink?: string;
    };

/**
 * A8 — an owner invites someone to one specific store with one specific role.
 *
 * Authorization is fully server-resolved: `storeId` arrives from the client but is
 * verified against the session's own tenant before anything else happens (never trust a
 * client-supplied store id as authoritative — see SECURITY.md's "resource scope is
 * resolved server-side" section, established at A7 and reapplied here).
 *
 * `role` is checked against `INVITABLE_STORE_ROLES` — OWNER can never be granted through
 * this payload, closing the privilege-escalation path the brief specifically called out.
 *
 * Duplicate handling is deterministic, not fuzzy: an existing StoreMembership for this
 * (user, store) pair blocks the invitation outright (`already_member`); an email already
 * belonging to a *different* tenant is rejected up front (`email_unavailable`) because
 * `User.email` is globally unique — that invitation could never be accepted regardless of
 * how it's processed. A still-pending invitation for the same (tenant, store, email) is
 * superseded (revoked) before the new one is created, the same supersession shape as A3's
 * PasswordResetToken (ADR-027) — only one live invitation per (store, email) at a time.
 */
export async function createInvitation(input: CreateInvitationInput): Promise<CreateInvitationResult> {
  const session = await resolveSession(input.sessionToken);
  if (!session) {
    return { status: "unauthorized" };
  }

  if (
    await isIpRateLimited(input.ip, "invitation_create", {
      windowMs: 60 * 60 * 1000,
      threshold: env.INVITATION_CREATE_MAX_PER_WINDOW,
    })
  ) {
    return { status: "rate_limited" };
  }

  if (session.user.tenantRole !== "OWNER") {
    await writeAuditLog({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "InvitationCreateForbidden",
      correlationId: input.correlationId,
    });
    return { status: "forbidden" };
  }

  if (!isInvitableStoreRole(input.role)) {
    return { status: "invalid_role" };
  }

  const store = await db.store.findUnique({ where: { id: input.storeId } });
  if (!store || store.tenantId !== session.tenantId) {
    // Same generic response for "doesn't exist" and "belongs to another tenant" — a
    // cross-tenant store id must not be distinguishable from a typo.
    return { status: "invalid_store" };
  }

  const email = input.email.trim().toLowerCase();

  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    if (existingUser.tenantId !== session.tenantId) {
      // User.email is globally unique (no multi-tenant user support) — this invitation
      // could never be accepted regardless of what A11 does with it later.
      return { status: "email_unavailable" };
    }
    const existingMembership = await db.storeMembership.findUnique({
      where: { userId_storeId: { userId: existingUser.id, storeId: input.storeId } },
    });
    if (existingMembership) {
      return { status: "already_member" };
    }
    // Existing tenant member, different store: still goes through the same invite+token
    // flow rather than an instant grant — one consistent, audited mechanism for both new
    // and existing users. Instant membership grants belong to screen 67, not A8.
  }

  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.INVITATION_TTL_HOURS * 60 * 60 * 1000);

  // Single atomic INSERT ... ON CONFLICT DO UPDATE — not a read-then-write — so two
  // concurrent double-click requests for the same (tenant, store, email) can't both
  // observe "no pending invite yet" and each create a live row. Whichever commits second
  // just overwrites the first's token/expiry/role, which is exactly the desired
  // "superseded by the newest invite" behavior. See the model comment in schema.prisma.
  const invitation = await db.invitation.upsert({
    where: { tenantId_storeId_email: { tenantId: session.tenantId, storeId: input.storeId, email } },
    create: {
      tenantId: session.tenantId,
      storeId: input.storeId,
      email,
      role: input.role,
      inviterUserId: session.userId,
      tokenHash: hashOpaqueToken(token),
      expiresAt,
    },
    update: {
      role: input.role,
      inviterUserId: session.userId,
      tokenHash: hashOpaqueToken(token),
      expiresAt,
      lastSentAt: new Date(),
      resendCount: 0,
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
    },
  });

  await identityNotifier.sendInvitation({
    destination: email,
    inviteUrl: inviteUrl(token),
    tenantName: (await db.tenant.findUnique({ where: { id: session.tenantId }, select: { name: true } }))!.name,
    storeName: store.name,
    role: input.role,
  });

  await recordAttempt({ email: session.user.email, ip: input.ip, success: true, context: "invitation_create" });
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "InvitationCreated",
    correlationId: input.correlationId,
    metadata: { invitationId: invitation.id, storeId: input.storeId, role: input.role },
  });

  return {
    status: "ok",
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      storeId: invitation.storeId,
      expiresAt: invitation.expiresAt.toISOString(),
    },
    ...(env.DEV_INVITE_LINK_ECHO ? { devInviteLink: inviteUrl(token) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

export type ResendInvitationResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited" }
  | { status: "not_found" }
  | { status: "invalid_state" }
  | { status: "cooldown"; retryAfterSeconds: number }
  | { status: "ok"; expiresAt: string; devInviteLink?: string };

/** Regenerates the token and refreshes expiry — the old link stops working, same shape as MfaChallenge's resend. */
export async function resendInvitation(params: {
  sessionToken: string;
  invitationId: string;
  ip: string;
  correlationId: string;
}): Promise<ResendInvitationResult> {
  const session = await resolveSession(params.sessionToken);
  if (!session) {
    return { status: "unauthorized" };
  }

  if (
    await isIpRateLimited(params.ip, "invitation_resend", {
      windowMs: 60 * 60 * 1000,
      threshold: env.INVITATION_RESEND_MAX_PER_WINDOW,
    })
  ) {
    return { status: "rate_limited" };
  }

  if (session.user.tenantRole !== "OWNER") {
    return { status: "forbidden" };
  }

  const invitation = await db.invitation.findUnique({
    where: { id: params.invitationId },
    include: { store: true },
  });
  if (!invitation || invitation.tenantId !== session.tenantId) {
    return { status: "not_found" };
  }

  const status = deriveInvitationStatus(invitation);
  if (status !== "PENDING" && status !== "EXPIRED") {
    // Accepted/revoked invitations are dead ends — resending is meaningless and would
    // reactivate a link that shouldn't be reachable anymore.
    return { status: "invalid_state" };
  }

  const secondsSinceLastSend = (Date.now() - invitation.lastSentAt.getTime()) / 1000;
  if (status === "PENDING" && secondsSinceLastSend < env.INVITATION_RESEND_COOLDOWN_SECONDS) {
    return {
      status: "cooldown",
      retryAfterSeconds: Math.ceil(env.INVITATION_RESEND_COOLDOWN_SECONDS - secondsSinceLastSend),
    };
  }

  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.INVITATION_TTL_HOURS * 60 * 60 * 1000);

  await db.invitation.update({
    where: { id: invitation.id },
    data: { tokenHash: hashOpaqueToken(token), expiresAt, lastSentAt: new Date(), resendCount: { increment: 1 } },
  });

  const tenant = await db.tenant.findUnique({ where: { id: session.tenantId }, select: { name: true } });
  await identityNotifier.sendInvitation({
    destination: invitation.email,
    inviteUrl: inviteUrl(token),
    tenantName: tenant!.name,
    storeName: invitation.store.name,
    role: invitation.role,
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "InvitationResent",
    correlationId: params.correlationId,
    metadata: { invitationId: invitation.id },
  });

  return {
    status: "ok",
    expiresAt: expiresAt.toISOString(),
    ...(env.DEV_INVITE_LINK_ECHO ? { devInviteLink: inviteUrl(token) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

export type RevokeInvitationResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "already_accepted" }
  | { status: "ok" };

export async function revokeInvitation(params: {
  sessionToken: string;
  invitationId: string;
  correlationId: string;
}): Promise<RevokeInvitationResult> {
  const session = await resolveSession(params.sessionToken);
  if (!session) {
    return { status: "unauthorized" };
  }

  if (session.user.tenantRole !== "OWNER") {
    return { status: "forbidden" };
  }

  const invitation = await db.invitation.findUnique({ where: { id: params.invitationId } });
  if (!invitation || invitation.tenantId !== session.tenantId) {
    return { status: "not_found" };
  }

  if (invitation.acceptedAt) {
    // A real StoreMembership already exists off the back of this invitation — revoking
    // the invitation now would do nothing meaningful and could confuse audit history.
    return { status: "already_accepted" };
  }

  if (!invitation.revokedAt) {
    await db.invitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
    await writeAuditLog({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "InvitationRevoked",
      correlationId: params.correlationId,
      metadata: { invitationId: invitation.id },
    });
  }
  // Already revoked: idempotent no-op success, not an error — a safe retry.

  return { status: "ok" };
}

// ---------------------------------------------------------------------------
// List (for A8's own team/invitation table)
// ---------------------------------------------------------------------------

export type ListInvitationsResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | {
      status: "ok";
      invitations: Array<{
        id: string;
        email: string;
        role: string;
        storeId: string;
        status: InvitationStatus;
        expiresAt: string;
        createdAt: string;
      }>;
    };

export async function listInvitations(params: { sessionToken: string }): Promise<ListInvitationsResult> {
  const session = await resolveSession(params.sessionToken);
  if (!session) {
    return { status: "unauthorized" };
  }
  if (session.user.tenantRole !== "OWNER") {
    return { status: "forbidden" };
  }

  const rows = await db.invitation.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: "desc" },
  });

  return {
    status: "ok",
    invitations: rows.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      storeId: inv.storeId,
      status: deriveInvitationStatus(inv),
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Resolve (built now for A11 — not called by any route yet, same pattern as A5's
// resolveOnboardingSession being built one screen ahead of A6's need for it)
// ---------------------------------------------------------------------------

/**
 * The single token->invitation lookup in the system. `resolveInvitation` and
 * `previewInvitation` are purpose-specific wrappers over this one implementation — A11
 * must not add a second lookup/validation path.
 */
async function findInvitationByToken(token: string) {
  return db.invitation.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    include: { tenant: true, store: true },
  });
}

/** Strict: returns the invitation only when it is genuinely acceptable right now. */
export async function resolveInvitation(token: string) {
  const invitation = await findInvitationByToken(token);

  if (!invitation) return null;
  if (deriveInvitationStatus(invitation) !== "PENDING") return null;

  return invitation;
}

// One literal per member so this is a properly discriminated union — a single member
// carrying `"EXPIRED" | "REVOKED" | "ACCEPTED"` cannot be narrowed away by callers.
export type InvitationPreview =
  | { status: "invalid" }
  | { status: "EXPIRED" }
  | { status: "REVOKED" }
  | { status: "ACCEPTED" }
  | {
      status: "PENDING";
      email: string;
      role: string;
      tenantName: string;
      storeName: string;
      expiresAt: string;
      /** True when an AMBURAX account already exists for the invited email. */
      accountExists: boolean;
    };

/**
 * Read-only view for the acceptance screen. Distinguishing EXPIRED/REVOKED/ACCEPTED from
 * "invalid" is deliberate and safe: only someone already holding the exact 256-bit token
 * can reach any of these branches, so the distinction leaks nothing to a non-holder while
 * being much better UX — the same reasoning documented for A4 in SECURITY.md's "when token
 * possession, not identity, is the credential."
 *
 * Never returns tenant/store ids, the inviter, or anything about unrelated users.
 */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const invitation = await findInvitationByToken(token);
  if (!invitation) return { status: "invalid" };

  const status = deriveInvitationStatus(invitation);
  if (status !== "PENDING") return { status };

  const existingUser = await db.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });

  return {
    status: "PENDING",
    email: invitation.email,
    role: invitation.role,
    tenantName: invitation.tenant.name,
    storeName: invitation.store.name,
    expiresAt: invitation.expiresAt.toISOString(),
    accountExists: !!existingUser,
  };
}
