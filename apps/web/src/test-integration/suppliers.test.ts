import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import {
  canManageSuppliers,
  countSuppliers,
  createSupplier,
  listSuppliers,
  setSupplierActive,
  updateSupplier,
} from "@/server/purchasing/suppliers";

/** Supplier directory: validation, tenant isolation, duplicate names, status and audit. */

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});

afterAll(async () => {
  await resetDatabase();
});

const base = { tenantId: IDS.tenantA, actorUserId: IDS.ownerA };

describe("supplier directory", () => {
  it("creates a supplier with normalised fields and an audit row", async () => {
    const res = await createSupplier({
      ...base,
      input: { name: "  Sharma Textiles ", phone: "98765 43210", gstin: "27abcde1234f1z5", city: " Surat " },
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.supplier.name).toBe("Sharma Textiles");
    expect(res.supplier.gstin).toBe("27ABCDE1234F1Z5");
    expect(res.supplier.city).toBe("Surat");
    expect(res.supplier.phone).not.toBeNull();
    const audit = await db.auditLog.findMany({ where: { tenantId: IDS.tenantA, action: "supplier.created" } });
    expect(audit).toHaveLength(1);
  });

  it("rejects a malformed GSTIN and writes nothing", async () => {
    const res = await createSupplier({ ...base, input: { name: "Bad Gst", gstin: "NOTAGSTIN" } });
    expect(res).toMatchObject({ status: "validation_error", field: "gstin" });
    expect(await db.supplier.count()).toBe(0);
  });

  it("refuses a duplicate name within a tenant but allows it across tenants", async () => {
    await createSupplier({ ...base, input: { name: "Kumar Fabrics" } });
    expect((await createSupplier({ ...base, input: { name: "Kumar Fabrics" } })).status).toBe("duplicate_name");
    const other = await createSupplier({
      tenantId: IDS.tenantB,
      actorUserId: IDS.ownerB,
      input: { name: "Kumar Fabrics" },
    });
    expect(other.status).toBe("ok");
  });

  it("never lists, updates or deactivates another tenant's supplier", async () => {
    const b = await createSupplier({ tenantId: IDS.tenantB, actorUserId: IDS.ownerB, input: { name: "B Only" } });
    if (b.status !== "ok") throw new Error("seed failed");
    expect((await listSuppliers({ tenantId: IDS.tenantA })).map((s) => s.name)).toEqual([]);
    expect(
      (await updateSupplier({ ...base, supplierId: b.supplier.id, input: { name: "Hijacked" } })).status,
    ).toBe("not_found");
    expect((await setSupplierActive({ ...base, supplierId: b.supplier.id, isActive: false })).status).toBe(
      "not_found",
    );
    const fresh = await db.supplier.findUniqueOrThrow({ where: { id: b.supplier.id } });
    expect(fresh).toMatchObject({ name: "B Only", isActive: true });
  });

  it("moves a supplier between the active and inactive lists, and searches", async () => {
    const a = await createSupplier({ ...base, input: { name: "Alpha Mills", city: "Ludhiana" } });
    await createSupplier({ ...base, input: { name: "Beta Traders" } });
    if (a.status !== "ok") throw new Error("seed failed");
    await setSupplierActive({ ...base, supplierId: a.supplier.id, isActive: false });
    expect((await listSuppliers({ tenantId: IDS.tenantA })).map((s) => s.name)).toEqual(["Beta Traders"]);
    expect((await listSuppliers({ tenantId: IDS.tenantA, status: "inactive" })).map((s) => s.name)).toEqual([
      "Alpha Mills",
    ]);
    expect(
      (await listSuppliers({ tenantId: IDS.tenantA, status: "inactive", query: "ludh" })).map((s) => s.name),
    ).toEqual(["Alpha Mills"]);
    expect(await countSuppliers(IDS.tenantA)).toEqual({ active: 1, inactive: 1 });
  });
});

describe("canManageSuppliers", () => {
  it("allows a tenant owner and a store manager only", () => {
    expect(canManageSuppliers({ tenantRole: "OWNER", membershipRole: null })).toBe(true);
    expect(canManageSuppliers({ tenantRole: "STAFF", membershipRole: "STORE_MANAGER" })).toBe(true);
    expect(canManageSuppliers({ tenantRole: "STAFF", membershipRole: "CASHIER" })).toBe(false);
    expect(canManageSuppliers({ tenantRole: "STAFF", membershipRole: null })).toBe(false);
  });
});
