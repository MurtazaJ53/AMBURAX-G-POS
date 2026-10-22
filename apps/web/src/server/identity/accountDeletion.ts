import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";

export interface DeleteAccountResult {
  status: "ok" | "not_found" | "owner_cannot_delete" | "has_active_obligations";
  message?: string;
}

/**
 * Anonymizes or deletes personal account data for a User under GDPR / DPDP guidelines.
 *
 * Historical sales and transactions keep an anonymized audit link (e.g. "Deleted User"),
 * while personal credentials, email, password hashes, and active sessions are revoked or wiped.
 */
export async function deleteUserAccount(params: {
  tenantId: string;
  userId: string;
  correlationId: string;
}): Promise<DeleteAccountResult> {
  const user = await db.user.findUnique({
    where: { id: params.userId },
    include: { tenant: true },
  });

  if (!user || user.tenantId !== params.tenantId) {
    return { status: "not_found", message: "User account not found." };
  }

  // An OWNER cannot unilaterally delete themselves if other staff or stores exist.
  // The business must first transfer ownership or close the tenant.
  if (user.tenantRole === "OWNER") {
    const staffCount = await db.user.count({
      where: { tenantId: params.tenantId, tenantRole: "STAFF" },
    });
    if (staffCount > 0) {
      return {
        status: "owner_cannot_delete",
        message: "Tenant owner account cannot be deleted while active staff members remain. Reassign ownership first.",
      };
    }
  }

  await db.$transaction(async (tx) => {
    // 1. Invalidate all active sessions immediately
    await tx.session.deleteMany({
      where: { userId: user.id },
    });

    // 2. Clear any pending MFA challenges and password reset tokens
    await tx.mfaChallenge.deleteMany({
      where: { userId: user.id },
    });
    await tx.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    // 3. Anonymize user identifying information so historical sales references remain intact
    const anonymizedEmail = `deleted_${user.id}_${Date.now()}@anonymized.local`;
    await tx.user.update({
      where: { id: user.id },
      data: {
        name: "Deleted User",
        email: anonymizedEmail,
        passwordHash: "$2b$10$DELETED_ACCOUNT_NEVER_MATCHES_ANY_PASSWORD",
        approvalPinHash: null,
        status: "DISABLED",
      },
    });

    // 4. Log the deletion event for compliance
    await tx.auditLog.create({
      data: {
        tenantId: params.tenantId,
        userId: user.id,
        action: "UserAccountDeletedAndAnonymized",
        correlationId: params.correlationId,
        metadata: { originalRole: user.tenantRole },
      },
    });
  });

  return { status: "ok" };
}

/**
 * Anonymizes or deletes customer PII under GDPR / Right-to-be-Forgotten.
 */
export async function deleteCustomerData(params: {
  tenantId: string;
  customerId: string;
  correlationId: string;
}): Promise<{ status: "ok" | "not_found" | "has_unsettled_balance"; message?: string }> {
  const customer = await db.customer.findUnique({
    where: { id: params.customerId },
  });

  if (!customer || customer.tenantId !== params.tenantId) {
    return { status: "not_found", message: "Customer not found." };
  }

  // Ensure customer has no unsettled credit balance before anonymizing
  const unsettled = await db.sale.count({
    where: {
      tenantId: params.tenantId,
      customerId: customer.id,
      status: "COMPLETED",
      paidMinor: { lt: db.sale.fields.totalMinor },
    },
  });

  if (unsettled > 0) {
    return {
      status: "has_unsettled_balance",
      message: "Cannot delete customer record with unsettled credit or khata balances.",
    };
  }

  await db.$transaction(async (tx) => {
    // Remove or unlink customer addresses
    await tx.customerAddress.deleteMany({
      where: { customerId: customer.id, tenantId: params.tenantId },
    });

    // Anonymize the customer row to preserve historical sales totals
    await tx.customer.update({
      where: { id: customer.id },
      data: {
        name: "Anonymized Customer",
        phone: null,
        email: null,
        gstin: null,
        isActive: false,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: params.tenantId,
        action: "CustomerDataAnonymized",
        correlationId: params.correlationId,
        metadata: { customerId: customer.id },
      },
    });
  });

  return { status: "ok" };
}
