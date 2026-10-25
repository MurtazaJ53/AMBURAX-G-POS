import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { generateTenantSlug } from "@/server/tenant/slug";
import { createOnboardingSession } from "@/server/tenant/onboardingSession";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/identity/token";
import { isIpRateLimited, recordAttempt } from "@/server/identity/loginGuard";
import { writeAuditLog } from "@/server/identity/audit";
import { seedDefaultCapabilities } from "@/server/capability/capabilityService";
import { seedGarmentMasters } from "@/server/catalog/seedGarmentMasters";
import { gstinProblem, gstSchemeProblem, type GstScheme } from "@/server/catalog/gstSetup";

export type BusinessType = "RETAIL" | "WHOLESALE" | "MANUFACTURING" | "SERVICES" | "DISTRIBUTION" | "OTHER";

export interface RegisterBusinessInput {
  businessName: string;
  businessType: BusinessType;
  industry?: string;
  country: string;
  taxId?: string;
  /** Only REGULAR is supported; COMPOSITION is refused until Bills of Supply exist. */
  gstScheme?: GstScheme;
  contactEmail: string;
  contactPhone: string;
  idempotencyKey: string;
  ip: string;
  userAgent: string | null;
  correlationId: string;
}

export type RegisterBusinessResult =
  | { status: "rate_limited" }
  | { status: "validation_error"; reason: string }
  | { status: "ok"; businessName: string; onboardingToken: string; expiresAt: string };

const MAX_SLUG_ATTEMPTS = 3;

function isUniqueViolation(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta!.target as string[]).includes(field)
  );
}

/**
 * Idempotent by `idempotencyKey` (client-generated, persisted across retries in the
 * browser): a double-click, a network-retried POST, or a "did that go through?" resubmit
 * all resolve to the same tenant instead of creating duplicates. A registration token
 * can't be recovered on replay (only its hash is ever stored — see OnboardingSession), so
 * a replay issues a *fresh* onboarding session for the *same* tenant, which satisfies the
 * real requirement ("never create a second tenant") without needing to un-hash anything.
 *
 * The tenant row and its first OnboardingSession are written in one transaction — a
 * tenant that committed but whose onboarding token failed to write would exist but be
 * unreachable by its own registrant, with no way to proceed. The transaction makes that
 * "partial tenant creation" outcome impossible: either both rows exist or neither does.
 */
export async function registerBusiness(input: RegisterBusinessInput): Promise<RegisterBusinessResult> {
  if (input.taxId && input.taxId.trim()) {
    const problem = gstSchemeProblem(input.gstScheme) ?? gstinProblem(input.taxId);
    if (problem) {
      return { status: "validation_error", reason: problem };
    }
  }

  if (
    await isIpRateLimited(input.ip, "tenant_registration", {
      windowMs: 60 * 60 * 1000,
      threshold: env.TENANT_REGISTRATION_MAX_PER_WINDOW,
    })
  ) {
    await writeAuditLog({
      action: "TenantRegistrationRateLimited",
      correlationId: input.correlationId,
      metadata: { ip: input.ip },
    });
    return { status: "rate_limited" };
  }

  const existing = await db.tenant.findUnique({ where: { registrationKey: input.idempotencyKey } });
  if (existing) {
    const session = await createOnboardingSession({ tenantId: existing.id, ip: input.ip, userAgent: input.userAgent });
    await recordAttempt({
      email: input.contactEmail,
      ip: input.ip,
      success: true,
      reason: "idempotent_replay",
      context: "tenant_registration",
    });
    return {
      status: "ok",
      businessName: existing.name,
      onboardingToken: session.token,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    try {
      const result = await db.$transaction(async (tx) => {
        const slug = generateTenantSlug(input.businessName);
        const tenant = await tx.tenant.create({
          data: {
            id: randomUUID(),
            name: input.businessName,
            slug,
            businessType: input.businessType,
            industry: input.industry,
            country: input.country,
            taxId: input.taxId,
            contactEmail: input.contactEmail,
            contactPhone: input.contactPhone,
            registrationKey: input.idempotencyKey,
            termsAcceptedAt: new Date(),
            erpnextSiteId: "frontend",
            erpnextCompanyId: null,
            erpnextProvisionStatus: "NOT_PROVISIONED",
            erpnextProvisionedAt: null,
          },
        });

        // Seed default capabilities and Garment Masters (Size/Colour definitions, presets, and size groups)
        await seedDefaultCapabilities(tx, tenant.id);
        await seedGarmentMasters(tx as unknown as Prisma.TransactionClient, tenant.id);

        const token = generateOpaqueToken();
        const expiresAt = new Date(Date.now() + env.ONBOARDING_SESSION_TTL_MINUTES * 60 * 1000);
        await tx.onboardingSession.create({
          data: {
            tenantId: tenant.id,
            tokenHash: hashOpaqueToken(token),
            ip: input.ip,
            userAgent: input.userAgent ?? undefined,
            expiresAt,
          },
        });

        return { tenant, token, expiresAt };
      });

      await recordAttempt({ email: input.contactEmail, ip: input.ip, success: true, context: "tenant_registration" });
      await writeAuditLog({
        tenantId: result.tenant.id,
        action: "TenantCreated",
        correlationId: input.correlationId,
        metadata: { businessType: input.businessType, country: input.country },
      });

      return {
        status: "ok",
        businessName: result.tenant.name,
        onboardingToken: result.token,
        expiresAt: result.expiresAt.toISOString(),
      };
    } catch (err) {
      if (isUniqueViolation(err, "slug")) {
        continue; // regenerate a fresh slug and retry — collision odds are ~1 in 36^6
      }
      if (isUniqueViolation(err, "registrationKey")) {
        // Lost a true concurrent race: another request with the same idempotency key
        // committed first. Fetch the tenant it created and hand back a usable session
        // for it, same as the up-front replay path above.
        const winner = await db.tenant.findUniqueOrThrow({ where: { registrationKey: input.idempotencyKey } });
        const session = await createOnboardingSession({ tenantId: winner.id, ip: input.ip, userAgent: input.userAgent });
        await recordAttempt({
          email: input.contactEmail,
          ip: input.ip,
          success: true,
          reason: "lost_creation_race",
          context: "tenant_registration",
        });
        return {
          status: "ok",
          businessName: winner.name,
          onboardingToken: session.token,
          expiresAt: session.expiresAt.toISOString(),
        };
      }
      throw err;
    }
  }

  throw new Error("Could not allocate a unique tenant slug after multiple attempts.");
}
