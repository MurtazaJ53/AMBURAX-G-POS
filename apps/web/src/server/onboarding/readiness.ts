import { db } from "@/server/db";
import { derivePosDeviceStatus } from "@/server/pos/posDevice";
import { randomUUID } from "node:crypto";
import { deriveInvitationStatus } from "@/server/tenant/invitation";
import { ErpBankLinkReader, type BankLinkStatus } from "@/server/erp/bankLinkStatus";
import { ErpNegativeStockReader, type NegativeStockLine } from "@/server/erp/negativeStock";
import { logError } from "@/lib/safeLog";

/**
 * A10's authoritative readiness calculation. The single source of truth for "what is
 * actually working" — the `/onboarding/complete` page and `GET /api/v1/onboarding/status`
 * both render this one function's output, so the screen and the API can never disagree.
 * Nothing here is computed on the client.
 *
 * The central distinction this module exists to enforce:
 *
 *   onboardingComplete — the tenant walked the setup sequence to its end. A record of what
 *                        the merchant *did*. Intent-based, and deliberately not gated on
 *                        anything operational.
 *   operationalReady   — every capability a real sale actually needs is verified working.
 *                        A statement about the *system*.
 *
 * These are related and not identical, and conflating them is how a product ends up telling
 * a merchant their POS is ready when no terminal has ever paired.
 */

/**
 * Deliberately five levels, not a boolean, because "not set up" and "cannot be set up" are
 * different facts and a merchant needs to tell them apart:
 *
 *  READY          — verified working from authoritative server state.
 *  PENDING        — correctly configured, waiting on something outside Amburax (a terminal
 *                   that has not paired yet).
 *  ATTENTION      — configured but in a state the merchant must fix (expired pairing code,
 *                   disabled terminal).
 *  NOT_CONFIGURED — deliberately or simply not done yet. The merchant *can* fix this today.
 *  UNAVAILABLE    — the platform itself cannot do this yet. The merchant CANNOT fix it, and
 *                   telling them to "configure" it would be a lie. Payments and ERPNext
 *                   stock are here until those adapters exist.
 */
export type ReadinessLevel = "READY" | "PENDING" | "ATTENTION" | "NOT_CONFIGURED" | "UNAVAILABLE";

export type ReadinessKey = "business" | "owner" | "store" | "team" | "pos" | "inventory" | "payments" | "bank" | "negative_stock";

export interface ReadinessItem {
  key: ReadinessKey;
  label: string;
  level: ReadinessLevel;
  /** A truthful sentence for the merchant. Never aspirational, never a placeholder. */
  detail: string;
  /**
   * Whether this item stops a real sale from happening. Only these participate in
   * `operationalReady`, so an optional step (team) can be NOT_CONFIGURED without making
   * the whole workspace look broken.
   */
  blocksSale: boolean;
  /** Only set when the merchant can genuinely act on it today. UNAVAILABLE items get none. */
  action: { label: string; href: string } | null;
  /** The rows behind the item, when it is a list (negative stock). */
  lines?: NegativeStockLine[];
}

export interface OnboardingReadiness {
  onboardingStep: string;
  /** True once the tenant reached COMPLETE. Says nothing about whether anything works. */
  onboardingComplete: boolean;
  /** True only when every sale-blocking item is READY. */
  operationalReady: boolean;
  /** True when A10's completion transition is available right now. */
  canComplete: boolean;
  items: ReadinessItem[];
  /** Display names only — no internal ids leave the server. */
  businessName: string;
  storeName: string | null;
}

export type ReadinessResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "inconsistent"; reason: "missing_store" }
  | { status: "ok"; readiness: OnboardingReadiness };

/**
 * `tenantId` is always the caller's own, resolved from their session by the caller of this
 * function — never accepted from a request body. Nothing here reads across tenants.
 */
export async function getOnboardingReadiness(params: {
  tenantId: string;
  userId: string;
}): Promise<ReadinessResult> {
  const tenant = await db.tenant.findUnique({
    where: { id: params.tenantId },
    select: { name: true, onboardingStep: true, erpnextProvisionStatus: true },
  });
  if (!tenant) {
    return { status: "unauthorized" };
  }

  const store = await db.store.findFirst({
    where: { tenantId: params.tenantId },
    select: { id: true, name: true, storeType: true, erpnextProvisionStatus: true },
  });

  // A tenant past STORE_CREATED with no Store row is a genuinely broken state, not a normal
  // "not done yet". Reported as such rather than rendered as a cheerful checklist with one
  // item missing — the merchant needs a different response to corruption than to an unfinished
  // step, and silently degrading would hide a data bug.
  const pastStoreStep = !["BUSINESS_CREATED", "OWNER_CREATED"].includes(tenant.onboardingStep);
  if (pastStoreStep && !store) {
    return { status: "inconsistent", reason: "missing_store" };
  }

  const [memberCount, invitations, devices] = await Promise.all([
    store ? db.storeMembership.count({ where: { storeId: store.id } }) : Promise.resolve(0),
    db.invitation.findMany({
      where: { tenantId: params.tenantId },
      select: { acceptedAt: true, revokedAt: true, expiresAt: true },
    }),
    store
      ? db.posDevice.findMany({
          where: { storeId: store.id },
          select: { name: true, code: true, activatedAt: true, disabledAt: true, pairingExpiresAt: true },
        })
      : Promise.resolve([]),
  ]);

  const items: ReadinessItem[] = [
    {
      key: "business",
      label: "Business",
      level: "READY",
      detail: `${tenant.name} is set up.`,
      blocksSale: false,
      action: null,
    },
    {
      key: "owner",
      label: "Owner account",
      level: "READY",
      // A resolved session for a tenant OWNER is what got the caller here, so this is
      // verified rather than assumed.
      detail: "Your owner account is active.",
      blocksSale: false,
      action: null,
    },
    storeItem(store),
    teamItem(memberCount, invitations),
    posItem(devices),
    inventoryItem(store, tenant.erpnextProvisionStatus),
    paymentsItem(),
  ];

  // Only a connected business has a placeholder bank account to replace.
  if (tenant.erpnextProvisionStatus === "PROVISIONED") {
    const bank = bankItem(await readBankLink(params.tenantId));
    if (bank) items.push(bank);
    const negative = negativeStockItem(await readNegativeStock(params.tenantId));
    if (negative) items.push(negative);
  }

  return {
    status: "ok",
    readiness: {
      onboardingStep: tenant.onboardingStep,
      onboardingComplete: tenant.onboardingStep === "COMPLETE",
      operationalReady: items.every((item) => !item.blocksSale || item.level === "READY"),
      canComplete: tenant.onboardingStep === "POS_CONFIGURED",
      items,
      businessName: tenant.name,
      storeName: store?.name ?? null,
    },
  };
}

function storeItem(store: { name: string } | null): ReadinessItem {
  if (!store) {
    return {
      key: "store",
      label: "Store",
      level: "NOT_CONFIGURED",
      detail: "No store has been set up yet.",
      blocksSale: true,
      action: { label: "Set up your store", href: "/onboarding/store" },
    };
  }
  return {
    key: "store",
    label: "Store",
    level: "READY",
    detail: `${store.name} is set up and you have access to it.`,
    blocksSale: false,
    action: null,
  };
}

/**
 * Never an error state. A8's Skip is a first-class path (ADR-053), so "no team yet" is a
 * legitimate outcome the merchant chose, and this item never blocks a sale — the owner can
 * run the till alone.
 */
function teamItem(
  memberCount: number,
  invitations: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }[],
): ReadinessItem {
  const pending = invitations.filter((inv) => deriveInvitationStatus(inv) === "PENDING").length;
  // The owner's own membership (created at A7) is always present, so "team" means anyone else.
  const others = Math.max(0, memberCount - 1);

  if (others === 0 && pending === 0) {
    return {
      key: "team",
      label: "Team",
      level: "NOT_CONFIGURED",
      detail: "It's just you for now. You can invite staff whenever you're ready.",
      blocksSale: false,
      action: { label: "Invite your team", href: "/onboarding/team" },
    };
  }

  if (others === 0) {
    return {
      key: "team",
      label: "Team",
      level: "PENDING",
      detail:
        pending === 1
          ? "1 invitation sent — waiting for them to accept."
          : `${pending} invitations sent — waiting for them to accept.`,
      blocksSale: false,
      action: null,
    };
  }

  const joined = others === 1 ? "1 team member has joined" : `${others} team members have joined`;
  return {
    key: "team",
    label: "Team",
    level: "READY",
    detail: pending > 0 ? `${joined}, ${pending} still to accept.` : `${joined}.`,
    blocksSale: false,
    action: null,
  };
}

/**
 * The item this whole screen exists for. Derived from real `PosDevice` state via A9's
 * `derivePosDeviceStatus` — never inferred from `onboardingStep`. A tenant sitting at
 * POS_CONFIGURED with an unpaired terminal reports PENDING here, and the copy says so.
 */
function posItem(
  devices: {
    name: string;
    code: string;
    activatedAt: Date | null;
    disabledAt: Date | null;
    pairingExpiresAt: Date | null;
  }[],
): ReadinessItem {
  if (devices.length === 0) {
    return {
      key: "pos",
      label: "POS terminal",
      level: "NOT_CONFIGURED",
      detail: "No terminal has been set up. You can add one at any time.",
      blocksSale: true,
      action: { label: "Set up a terminal", href: "/onboarding/pos" },
    };
  }

  const statuses = devices.map((device) => ({ device, status: derivePosDeviceStatus(device) }));
  const active = statuses.filter((s) => s.status === "ACTIVE");
  if (active.length > 0) {
    return {
      key: "pos",
      label: "POS terminal",
      level: "READY",
      detail:
        active.length === 1
          ? `${active[0]!.device.name} (${active[0]!.device.code}) is paired and active.`
          : `${active.length} terminals are paired and active.`,
      blocksSale: false,
      action: null,
    };
  }

  const pending = statuses.filter((s) => s.status === "PENDING_ACTIVATION");
  if (pending.length > 0) {
    return {
      key: "pos",
      label: "POS terminal",
      level: "PENDING",
      // The exact sentence A10 must produce instead of "POS ready".
      detail: `POS setup is complete, but ${pending[0]!.device.name} still needs to be paired. Open AMBURAX POS on the counter device and enter its pairing code.`,
      blocksSale: true,
      action: null,
    };
  }

  const expired = statuses.filter((s) => s.status === "PAIRING_EXPIRED");
  if (expired.length > 0) {
    return {
      key: "pos",
      label: "POS terminal",
      level: "ATTENTION",
      detail: `${expired[0]!.device.name}'s pairing code expired before the terminal was paired. It needs a new code.`,
      blocksSale: true,
      action: null,
    };
  }

  return {
    key: "pos",
    label: "POS terminal",
    level: "ATTENTION",
    detail:
      devices.length === 1
        ? `${devices[0]!.name} is disabled and cannot sell.`
        : "Every terminal in this store is disabled and cannot sell.",
    blocksSale: true,
    action: null,
  };
}

/**
 * Stock is ERPNext-authoritative (ERPNEXT_COVERAGE.md). A Store row existing means Amburax
 * knows about the location; it does NOT mean a stock ledger exists to sell against. No
 * ERPNext adapter is built, so `erpnextProvisionStatus` sits at NOT_PROVISIONED and this
 * reports UNAVAILABLE — a platform gap the merchant cannot act on, not a task for them.
 */
function inventoryItem(
  store: { erpnextProvisionStatus: string } | null,
  tenantProvisionStatus: string,
): ReadinessItem {
  const provisioned =
    store?.erpnextProvisionStatus === "PROVISIONED" && tenantProvisionStatus === "PROVISIONED";

  if (provisioned) {
    return {
      key: "inventory",
      label: "Inventory",
      level: "READY",
      detail: "Your stock location is connected and ready.",
      blocksSale: false,
      action: null,
    };
  }

  return {
    key: "inventory",
    label: "Inventory",
    level: "UNAVAILABLE",
    detail:
      "Stock isn't connected yet. Your store is saved, but the inventory system that tracks stock and prices is still being set up on our side — nothing for you to do.",
    blocksSale: true,
    action: null,
  };
}

/**
 * There is no payment model, no gateway adapter, and no terminal integration anywhere in the
 * codebase. Reporting anything other than UNAVAILABLE here — including a "configure payments"
 * link to a screen that does not exist — would be the fabricated readiness the spec forbids.
 */
function paymentsItem(): ReadinessItem {
  return {
    key: "payments",
    label: "Payments",
    level: "UNAVAILABLE",
    detail:
      "Payment methods aren't available yet. Card, UPI and cash handling arrive with the checkout release.",
    blocksSale: true,
    action: null,
  };
}

/**
 * A failed ERPNext read leaves the item off rather than failing the whole checklist or
 * guessing: "unknown" is not a claim either way.
 */
async function readBankLink(tenantId: string): Promise<BankLinkStatus> {
  try {
    return await new ErpBankLinkReader().getBankLinkStatus(tenantId, randomUUID());
  } catch (err) {
    logError("readiness: bank link could not be read", err, { tenantId });
    return "unknown";
  }
}

/**
 * Provisioning points UPI and Credit Card at a placeholder "Bank - {abbr}" so sales can post on
 * day one. Takings then land in an account that is not the owner's real bank until they link it.
 * Never blocks a sale: the placeholder posts correctly, it just isn't reconciled to a real bank.
 */
function bankItem(status: BankLinkStatus): ReadinessItem | null {
  if (status === "unknown") return null;
  if (status === "linked") {
    return {
      key: "bank",
      label: "Bank account",
      level: "READY",
      detail: "UPI and card payments go to your own bank account.",
      blocksSale: false,
      action: null,
    };
  }
  return {
    key: "bank",
    label: "Link your real bank account",
    level: "NOT_CONFIGURED",
    detail:
      'UPI and card payments are being recorded in a placeholder account named "Bank". In ERPNext, open Mode of Payment for UPI and Credit Card and choose your real bank account for this company.',
    blocksSale: false,
    action: null,
  };
}

/** Same rule as the bank link: a failed ERPNext read leaves the item off, never guesses. */
async function readNegativeStock(tenantId: string): Promise<NegativeStockLine[] | null> {
  try {
    return await new ErpNegativeStockReader().listNegativeStock(tenantId, randomUUID());
  } catch (err) {
    logError("readiness: negative stock could not be read", err, { tenantId });
    return null;
  }
}

/**
 * Sales are allowed to take stock below zero (POS policy), so ERPNext can't stop it. This is the
 * owner's alert that something was sold before it was received. Never blocks a sale.
 */
function negativeStockItem(lines: NegativeStockLine[] | null): ReadinessItem | null {
  if (!lines) return null;
  if (lines.length === 0) {
    return {
      key: "negative_stock",
      label: "Negative stock",
      level: "READY",
      detail: "No item is below zero in stock.",
      blocksSale: false,
      action: null,
      lines: [],
    };
  }
  const shown = lines
    .slice(0, 5)
    .map((l) => `${l.itemName} (${l.qty})`)
    .join(", ");
  const more = lines.length > 5 ? ` and ${lines.length - 5} more` : "";
  return {
    key: "negative_stock",
    label: "Negative stock",
    level: "ATTENTION",
    detail: `${lines.length === 1 ? "1 item is" : `${lines.length} items are`} below zero in stock: ${shown}${more}. They were sold before being received — record the missing purchase or a stock count.`,
    blocksSale: false,
    action: null,
    lines,
  };
}
