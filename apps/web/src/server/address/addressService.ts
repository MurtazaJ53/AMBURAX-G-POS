import { Prisma, type AddressType } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";

/**
 * Customer addresses: create, list, update, choose defaults, deactivate.
 *
 * ## Ownership
 *
 * An `Address` belongs to a tenant. A `CustomerAddress` row says which customer it belongs to.
 * Both relations are composite — `(customerId, tenantId)` and `(addressId, tenantId)` — so
 * PostgreSQL rejects a link between a tenant-A customer and a tenant-B address regardless of what
 * this code believes, exactly as `StoreMembership` does for users and stores.
 *
 * ## Defaults
 *
 * The default billing and shipping addresses are two nullable pointers on `Customer`, not a flag
 * on the address. A column holds one value, so two conflicting defaults is not a state the
 * database can represent: there is nothing to race, nothing to reconcile, and no constraint needed
 * to forbid it. Setting a default is one UPDATE and the last writer wins — the correct semantics
 * for "which address should we use", where a stale answer is wrong but not corrupt.
 *
 * A default must be an address linked to that customer, still active, and of a compatible type:
 * BILLING or BOTH can be a billing default, SHIPPING or BOTH a shipping one.
 *
 * ## Deletion
 *
 * There is none. Addresses are deactivated. Once orders exist they will snapshot the address they
 * shipped to, and a deleted address would still be a hole in a customer's history — see
 * docs/architecture/ADDRESS.md for the snapshot rule this phase prepares for.
 *
 * ## Authorization
 *
 * Matches customer management, which is the operation these addresses belong to: any authenticated
 * user of the tenant, resolved server-side. `createCustomer` has the same rule. Introducing a
 * separate address permission would be inventing RBAC this codebase has not decided on yet.
 */

export interface AddressInput {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  /** ISO-3166 alpha-2. Uppercased on write. */
  country: string;
  contactName?: string | null;
  contactPhone?: string | null;
  type: AddressType;
}

export interface AddressRow {
  id: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  contactName: string | null;
  contactPhone: string | null;
  type: AddressType;
  isActive: boolean;
  isDefaultBilling: boolean;
  isDefaultShipping: boolean;
}

export type AddressFailure =
  | { status: "not_found"; what: "customer" | "address" }
  | { status: "validation_error"; field: string; reason: string }
  | { status: "in_use"; reason: string };

export type AddressResult = { status: "ok"; address: AddressRow } | AddressFailure;

const ADDRESS_SELECT = {
  id: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  contactName: true,
  contactPhone: true,
  type: true,
  isActive: true,
} as const;

/** Collapse runs of whitespace and trim. Addresses are typed by people, often in a hurry. */
function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

interface NormalizedAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  contactName: string | null;
  contactPhone: string | null;
  type: AddressType;
}

/**
 * Validate and normalise, server-side.
 *
 * Deliberately permissive about shape and strict about presence. A postal code is "up to 16
 * characters of letters, digits, spaces and hyphens" rather than six digits, because six digits is
 * an Indian PIN and this system will eventually see a Canadian one. The country is the single
 * strict field — two letters — because it is the value later tax and shipping logic will branch
 * on, and a free-text "India"/"IN"/"Bharat" mix would make that impossible.
 */
export function normalizeAddress(input: AddressInput): NormalizedAddress | AddressFailure {
  const required: [keyof AddressInput, string, number][] = [
    ["line1", "Enter the street address.", 200],
    ["city", "Enter the city.", 100],
    ["state", "Enter the state or province.", 100],
    ["postalCode", "Enter the postal code.", 16],
    ["country", "Enter the country.", 2],
  ];

  const cleaned: Record<string, string> = {};
  for (const [field, message, maxLength] of required) {
    const raw = input[field];
    const value = typeof raw === "string" ? tidy(raw) : "";
    if (value.length === 0) {
      return { status: "validation_error", field: String(field), reason: message };
    }
    if (value.length > maxLength) {
      return {
        status: "validation_error",
        field: String(field),
        reason: `That ${String(field)} is too long.`,
      };
    }
    cleaned[String(field)] = value;
  }

  const country = cleaned.country!.toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    return {
      status: "validation_error",
      field: "country",
      reason: "Use the two-letter country code, such as IN.",
    };
  }

  const postalCode = cleaned.postalCode!.toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 -]{0,15}$/.test(postalCode)) {
    return { status: "validation_error", field: "postalCode", reason: "Enter a valid postal code." };
  }

  const line2 = input.line2 ? tidy(input.line2) : "";
  if (line2.length > 200) {
    return { status: "validation_error", field: "line2", reason: "That address line is too long." };
  }

  const contactName = input.contactName ? tidy(input.contactName) : "";
  if (contactName.length > 200) {
    return { status: "validation_error", field: "contactName", reason: "That name is too long." };
  }

  const contactPhone = input.contactPhone ? tidy(input.contactPhone) : "";
  if (contactPhone.length > 0 && !/^[+0-9 ()-]{6,20}$/.test(contactPhone)) {
    return {
      status: "validation_error",
      field: "contactPhone",
      reason: "Enter a valid phone number.",
    };
  }

  return {
    line1: cleaned.line1!,
    line2: line2 || null,
    city: cleaned.city!,
    state: cleaned.state!,
    postalCode,
    country,
    contactName: contactName || null,
    contactPhone: contactPhone || null,
    type: input.type,
  };
}

function toRow(
  address: {
    id: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    contactName: string | null;
    contactPhone: string | null;
    type: AddressType;
    isActive: boolean;
  },
  defaults: { billingId: string | null; shippingId: string | null },
): AddressRow {
  return {
    ...address,
    isDefaultBilling: defaults.billingId === address.id,
    isDefaultShipping: defaults.shippingId === address.id,
  };
}

async function findCustomer(tenantId: string, customerId: string) {
  return db.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true, defaultBillingAddressId: true, defaultShippingAddressId: true },
  });
}

/**
 * Create an address and link it to a customer, in one transaction.
 *
 * Both halves or neither: an address with no owner would be an orphan nobody can find, and a link
 * to an address that failed to insert is impossible by construction.
 */
export async function createCustomerAddress(params: {
  tenantId: string;
  actorUserId: string;
  customerId: string;
  address: AddressInput;
  /** Also make it the default for its type, where the type allows. */
  makeDefault?: boolean;
  correlationId: string;
}): Promise<AddressResult> {
  const normalized = normalizeAddress(params.address);
  if ("status" in normalized) return normalized;

  const customer = await findCustomer(params.tenantId, params.customerId);
  // A customer belonging to another tenant answers exactly like one that does not exist.
  if (!customer) return { status: "not_found", what: "customer" };

  const created = await db.$transaction(async (tx) => {
    const address = await tx.address.create({
      data: { tenantId: params.tenantId, ...normalized },
      select: ADDRESS_SELECT,
    });

    await tx.customerAddress.create({
      data: { tenantId: params.tenantId, customerId: customer.id, addressId: address.id },
    });

    if (params.makeDefault) {
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          ...(normalized.type !== "SHIPPING" ? { defaultBillingAddressId: address.id } : {}),
          ...(normalized.type !== "BILLING" ? { defaultShippingAddressId: address.id } : {}),
        },
      });
    }

    return address;
  });

  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.actorUserId,
    action: "CustomerAddressCreated",
    correlationId: params.correlationId,
    metadata: {
      customerId: customer.id,
      addressId: created.id,
      type: created.type,
      madeDefault: Boolean(params.makeDefault),
    },
  });

  const after = await findCustomer(params.tenantId, params.customerId);
  return {
    status: "ok",
    address: toRow(created, {
      billingId: after?.defaultBillingAddressId ?? null,
      shippingId: after?.defaultShippingAddressId ?? null,
    }),
  };
}

export type ListAddressesResult = { status: "ok"; addresses: AddressRow[] } | AddressFailure;

/** Every address linked to a customer, newest first, with the defaults marked. */
export async function listCustomerAddresses(params: {
  tenantId: string;
  customerId: string;
  includeInactive?: boolean;
}): Promise<ListAddressesResult> {
  const customer = await findCustomer(params.tenantId, params.customerId);
  if (!customer) return { status: "not_found", what: "customer" };

  const links = await db.customerAddress.findMany({
    where: {
      tenantId: params.tenantId,
      customerId: customer.id,
      ...(params.includeInactive ? {} : { address: { isActive: true } }),
    },
    orderBy: { createdAt: "desc" },
    select: { address: { select: ADDRESS_SELECT } },
  });

  return {
    status: "ok",
    addresses: links.map((link) =>
      toRow(link.address, {
        billingId: customer.defaultBillingAddressId,
        shippingId: customer.defaultShippingAddressId,
      }),
    ),
  };
}

/**
 * Update an address in place.
 *
 * In place rather than copy-on-write, because nothing references it historically yet. When orders
 * arrive they snapshot the address at the time of the order, so editing this row will never
 * rewrite where something was already shipped. That rule is recorded in
 * docs/architecture/ADDRESS.md so the order phase inherits it rather than rediscovering it.
 */
export async function updateCustomerAddress(params: {
  tenantId: string;
  actorUserId: string;
  addressId: string;
  address: AddressInput;
  correlationId: string;
}): Promise<AddressResult> {
  const normalized = normalizeAddress(params.address);
  if ("status" in normalized) return normalized;

  const existing = await db.address.findFirst({
    where: { id: params.addressId, tenantId: params.tenantId },
    select: { id: true },
  });
  if (!existing) return { status: "not_found", what: "address" };

  const updated = await db.address.update({
    where: { id: existing.id },
    data: normalized,
    select: ADDRESS_SELECT,
  });

  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.actorUserId,
    action: "CustomerAddressUpdated",
    correlationId: params.correlationId,
    metadata: { addressId: updated.id, type: updated.type },
  });

  // Defaults are a customer-level fact and one address can be the default for more than one
  // customer, so they are not reported here.
  return { status: "ok", address: toRow(updated, { billingId: null, shippingId: null }) };
}

export type DefaultPurpose = "BILLING" | "SHIPPING";

export type SetDefaultResult =
  | { status: "ok"; customerId: string; purpose: DefaultPurpose; addressId: string }
  | AddressFailure;

/**
 * Choose the default billing or shipping address for a customer.
 *
 * One UPDATE of one column. The previous default is replaced by being overwritten — there is no
 * second row to clear, and therefore no window in which a customer has two defaults or none.
 *
 * The address must be linked to this customer, still active, and of a compatible type. A BOTH
 * address can be either default; a BILLING address cannot be the shipping default, because
 * sending goods to an accounts office is a mistake worth refusing rather than allowing.
 */
export async function setDefaultAddress(params: {
  tenantId: string;
  actorUserId: string;
  customerId: string;
  addressId: string;
  purpose: DefaultPurpose;
  correlationId: string;
}): Promise<SetDefaultResult> {
  const customer = await findCustomer(params.tenantId, params.customerId);
  if (!customer) return { status: "not_found", what: "customer" };

  const link = await db.customerAddress.findFirst({
    where: { tenantId: params.tenantId, customerId: customer.id, addressId: params.addressId },
    select: { address: { select: { id: true, type: true, isActive: true } } },
  });
  // Not linked, wrong tenant, or nonexistent — one answer for all three.
  if (!link) return { status: "not_found", what: "address" };

  if (!link.address.isActive) {
    return { status: "validation_error", field: "addressId", reason: "That address is inactive." };
  }

  const compatible =
    params.purpose === "BILLING"
      ? link.address.type === "BILLING" || link.address.type === "BOTH"
      : link.address.type === "SHIPPING" || link.address.type === "BOTH";
  if (!compatible) {
    return {
      status: "validation_error",
      field: "addressId",
      reason: `That address is marked ${link.address.type} and cannot be the ${params.purpose.toLowerCase()} default.`,
    };
  }

  await db.customer.update({
    where: { id: customer.id },
    data:
      params.purpose === "BILLING"
        ? { defaultBillingAddressId: link.address.id }
        : { defaultShippingAddressId: link.address.id },
  });

  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.actorUserId,
    action: "CustomerDefaultAddressSet",
    correlationId: params.correlationId,
    metadata: { customerId: customer.id, addressId: link.address.id, purpose: params.purpose },
  });

  return {
    status: "ok",
    customerId: customer.id,
    purpose: params.purpose,
    addressId: link.address.id,
  };
}

export type DeactivateResult = { status: "ok"; addressId: string } | AddressFailure;

/**
 * Retire an address.
 *
 * Refuses while the address is somebody's default, rather than silently clearing the pointer: a
 * customer who quietly loses their delivery address discovers it at the worst possible moment.
 * Choose a new default first, then retire this one.
 */
export async function deactivateAddress(params: {
  tenantId: string;
  actorUserId: string;
  addressId: string;
  correlationId: string;
}): Promise<DeactivateResult> {
  const address = await db.address.findFirst({
    where: { id: params.addressId, tenantId: params.tenantId },
    select: { id: true, isActive: true },
  });
  if (!address) return { status: "not_found", what: "address" };

  const defaultFor = await db.customer.count({
    where: {
      tenantId: params.tenantId,
      OR: [{ defaultBillingAddressId: address.id }, { defaultShippingAddressId: address.id }],
    },
  });
  if (defaultFor > 0) {
    return {
      status: "in_use",
      reason: "That address is a default for a customer. Choose another default first.",
    };
  }

  await db.address.update({ where: { id: address.id }, data: { isActive: false } });

  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.actorUserId,
    action: "CustomerAddressDeactivated",
    correlationId: params.correlationId,
    metadata: { addressId: address.id },
  });

  return { status: "ok", addressId: address.id };
}

export type SetGstinResult =
  | { status: "ok"; customerId: string; gstin: string | null }
  | AddressFailure;

/**
 * A shape check, not a verification: 15 characters in the documented GSTIN layout. No government
 * lookup happens, nothing is checked against a registry, and the check digit is not computed —
 * claiming otherwise would be the kind of false capability P1-3 removed from this product.
 */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/;

/** Record a customer's GSTIN, or clear it. Stored uppercase so one number has one spelling. */
export async function setCustomerGstin(params: {
  tenantId: string;
  actorUserId: string;
  customerId: string;
  gstin: string | null;
  correlationId: string;
}): Promise<SetGstinResult> {
  const customer = await findCustomer(params.tenantId, params.customerId);
  if (!customer) return { status: "not_found", what: "customer" };

  let value: string | null = null;
  if (params.gstin !== null && params.gstin.trim().length > 0) {
    value = params.gstin.trim().toUpperCase().replace(/\s+/g, "");
    if (!GSTIN_PATTERN.test(value)) {
      return { status: "validation_error", field: "gstin", reason: "That does not look like a GSTIN." };
    }
  }

  await db.customer.update({ where: { id: customer.id }, data: { gstin: value } });

  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.actorUserId,
    action: "CustomerGstinSet",
    correlationId: params.correlationId,
    // The number is a business identifier printed on every invoice, not a credential, but there
    // is no reason to repeat it here — which customer changed is the auditable fact.
    metadata: { customerId: customer.id, cleared: value === null },
  });

  return { status: "ok", customerId: customer.id, gstin: value };
}

/**
 * Link an address that already exists to another customer of the same tenant.
 *
 * Exists because the join table is the point: a group buyer's shared godown is one address that
 * several customer records deliver to. The composite foreign keys make a cross-tenant link
 * impossible; this function's own check turns that into a clean `not_found` rather than a
 * constraint violation.
 */
export async function linkAddressToCustomer(params: {
  tenantId: string;
  customerId: string;
  addressId: string;
}): Promise<{ status: "ok" } | AddressFailure> {
  const customer = await findCustomer(params.tenantId, params.customerId);
  if (!customer) return { status: "not_found", what: "customer" };

  const address = await db.address.findFirst({
    where: { id: params.addressId, tenantId: params.tenantId },
    select: { id: true },
  });
  if (!address) return { status: "not_found", what: "address" };

  try {
    await db.customerAddress.create({
      data: { tenantId: params.tenantId, customerId: customer.id, addressId: address.id },
    });
  } catch (err) {
    // Already linked. Idempotent by intent: the caller wanted this link to exist, and it does.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { status: "ok" };
    }
    throw err;
  }

  return { status: "ok" };
}
