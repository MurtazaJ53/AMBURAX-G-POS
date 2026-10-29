import { beforeEach, describe, expect, it } from "vitest";
import { db, IDS, resetDatabase, seedTwoTenants } from "./db";
import { registerBusiness } from "@/server/tenant/registrationService";
import { turnOnGst } from "@/server/catalog/gstSetup";
import { GSTIN_TAKEN_MESSAGE } from "@/server/tenant/gstinUniqueness";

/**
 * One GSTIN, one active business. Compared trimmed and uppercased; "active" is
 * Tenant.status = ACTIVE (a SUSPENDED tenant does not hold its GSTIN; deleted tenants are gone).
 */

const GSTIN = "27ABCDE1234F1Z0"; // Maharashtra, valid check digit; tenant A's fixture store is in MH.
const ownerA = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const };

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});

let n = 0;
function signUp(taxId: string, idempotencyKey = `gstin-${++n}-${Date.now()}`) {
  return registerBusiness({
    businessName: `GSTIN Test ${n}`,
    businessType: "RETAIL",
    country: "IN",
    taxId,
    gstScheme: "REGULAR",
    contactEmail: `gstin-${n}@example.test`,
    contactPhone: "+910000000088",
    idempotencyKey,
    ip: `10.8.0.${n % 250}`,
    userAgent: null,
    correlationId: `gstin-${n}`,
  });
}

describe("GSTIN uniqueness", () => {
  it("refuses a sign-up whose GSTIN an active tenant already holds, however it was typed", async () => {
    await db.tenant.update({ where: { id: IDS.tenantB }, data: { taxId: ` ${GSTIN.toLowerCase()} ` } });
    expect(await signUp(GSTIN)).toEqual({ status: "validation_error", reason: GSTIN_TAKEN_MESSAGE });
    expect(await db.tenant.count()).toBe(2);
  });

  it("allows the sign-up when the holder is suspended, and a replay of the same sign-up", async () => {
    await db.tenant.update({ where: { id: IDS.tenantB }, data: { taxId: GSTIN, status: "SUSPENDED" } });
    const key = `gstin-replay-${Date.now()}`;
    expect((await signUp(GSTIN, key)).status).toBe("ok");
    // The same sign-up retried (double-click, refresh) is its own tenant re-saving its GSTIN.
    expect((await signUp(GSTIN, key)).status).toBe("ok");
    expect(await db.tenant.count({ where: { taxId: GSTIN, status: "ACTIVE" } })).toBe(1);
  });

  it("refuses turning GST on with a GSTIN another active tenant holds", async () => {
    await db.tenant.update({ where: { id: IDS.tenantB }, data: { taxId: GSTIN } });
    expect(await turnOnGst({ actor: ownerA, gstin: GSTIN.toLowerCase() })).toEqual({
      status: "invalid",
      reason: GSTIN_TAKEN_MESSAGE,
    });
    expect((await db.tenant.findUniqueOrThrow({ where: { id: IDS.tenantA } })).taxId).toBeNull();
  });

  it("lets a tenant turn GST on with its own GSTIN, and only once", async () => {
    expect((await turnOnGst({ actor: ownerA, gstin: GSTIN })).status).toBe("ok");
    expect((await turnOnGst({ actor: ownerA, gstin: GSTIN })).status).toBe("already_registered");
  });
});
