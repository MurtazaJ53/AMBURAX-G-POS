import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, IDS, resetDatabase, seedTwoTenants, seedCommerce } from "./db";
import { listSalesForExport, SALES_EXPORT_MAX_ROWS, type SalesFilters } from "@/server/sales/saleQueries";
import { parseDate } from "@/server/sales/salesFilterParams";
import { toSalesCsv } from "@/server/sales/salesCsv";

/**
 * Sales CSV export against real PostgreSQL: tenant/store isolation, the Sales screen's filters,
 * stored amounts (discount included) exported unchanged, and the 5,000-row cap.
 */

const T = IDS.tenantA;
const STORE_A2 = "s-export-aaaaaaaaaaaaaaa2";
let seq = 0;

async function fixtureSale(opts: {
  tenantId?: string;
  storeId?: string;
  cashier?: string;
  billNumber?: string;
  completedAt?: Date;
  status?: "COMPLETED" | "VOIDED";
  method?: "CASH" | "UPI" | "CARD";
  discountMinor?: number;
}) {
  seq += 1;
  const discount = opts.discountMinor ?? 0;
  return db.sale.create({
    data: {
      tenantId: opts.tenantId ?? T,
      storeId: opts.storeId ?? IDS.storeA,
      billNumber: opts.billNumber ?? `EXP-${String(seq).padStart(6, "0")}`,
      cashierUserId: opts.cashier ?? IDS.ownerA,
      subtotalMinor: 9_524,
      taxMinor: 476,
      discountMinor: discount,
      // A stored discount always carries its reason and authoriser (sales_discount_reason_check).
      ...(discount > 0 ? { discountReason: "Fixture discount", discountAuthorisedByUserId: IDS.ownerA } : {}),
      totalMinor: 10_000 - discount,
      paidMinor: 10_000 - discount,
      status: opts.status ?? "COMPLETED",
      idempotencyKey: `exp-${seq}-${Date.now()}`,
      completedAt: opts.completedAt ?? new Date("2026-10-10T06:30:00.000Z"),
      payments: { create: [{ method: opts.method ?? "CASH", status: "CONFIRMED", amountMinor: 10_000 - discount }] },
    },
  });
}

const exportFor = (filters: SalesFilters = {}) => listSalesForExport({ tenantId: T, storeId: IDS.storeA, ...filters });

beforeEach(async () => {
  seq = 0;
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  await db.store.create({
    data: { id: STORE_A2, tenantId: T, name: "Store A2", code: "SA2", currency: "INR", addressLine: "2 St", city: "Pune", state: "MH" },
  });
});

afterAll(async () => {
  await resetDatabase();
});

describe("scope", () => {
  it("exports only the session tenant's session store", async () => {
    await fixtureSale({ billNumber: "MINE-1" });
    await fixtureSale({ billNumber: "OTHER-STORE", storeId: STORE_A2 });
    await fixtureSale({ billNumber: "OTHER-TENANT", tenantId: IDS.tenantB, storeId: IDS.storeB, cashier: IDS.ownerB });

    const res = await exportFor();
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.rows.map((r) => r.billNumber)).toEqual(["MINE-1"]);
  });
});

describe("values", () => {
  it("exports stored amounts exactly, including a stored discount, with only the approved fields", async () => {
    await fixtureSale({ billNumber: "DISC-1", discountMinor: 1_234 });
    const res = await exportFor();
    if (res.status !== "ok") throw new Error(res.status);
    expect(res.rows).toEqual([
      {
        billNumber: "DISC-1",
        completedAt: new Date("2026-10-10T06:30:00.000Z"),
        paymentMethod: "CASH",
        status: "COMPLETED",
        subtotalMinor: 9_524,
        taxMinor: 476,
        discountMinor: 1_234,
        totalMinor: 8_766,
        paidMinor: 8_766,
      },
    ]);
    const csv = toSalesCsv(res.rows).slice(1).split("\r\n");
    expect(csv[1]).toBe("DISC-1,2026-10-10 12:00:00,CASH,COMPLETED,95.24,4.76,12.34,87.66,87.66");
  });

  it("joins the methods of a split-tender sale like the Sales list does", async () => {
    const sale = await fixtureSale({ billNumber: "SPLIT-1" });
    await db.salePayment.create({ data: { saleId: sale.id, method: "UPI", status: "CONFIRMED", amountMinor: 1 } });
    const res = await exportFor();
    if (res.status !== "ok") throw new Error(res.status);
    expect(res.rows[0]!.paymentMethod?.split(" + ").sort()).toEqual(["CASH", "UPI"]);
  });
});

describe("filters", () => {
  beforeEach(async () => {
    await fixtureSale({ billNumber: "OCT-01-CASH", completedAt: new Date("2026-10-01T05:00:00.000Z"), method: "CASH" });
    await fixtureSale({ billNumber: "OCT-05-UPI", completedAt: new Date("2026-10-05T05:00:00.000Z"), method: "UPI" });
    await fixtureSale({ billNumber: "OCT-09-VOID", completedAt: new Date("2026-10-09T05:00:00.000Z"), status: "VOIDED" });
  });

  const bills = async (filters: SalesFilters) => {
    const res = await exportFor(filters);
    if (res.status !== "ok") throw new Error(res.status);
    return res.rows.map((r) => r.billNumber).sort();
  };

  it("applies method, status, date range and search like the Sales screen", async () => {
    expect(await bills({ method: "UPI" })).toEqual(["OCT-05-UPI"]);
    expect(await bills({ status: "VOIDED" })).toEqual(["OCT-09-VOID"]);
    expect(await bills({ from: parseDate("2026-10-02"), to: parseDate("2026-10-06", true) })).toEqual(["OCT-05-UPI"]);
    expect(await bills({ query: "oct-01" })).toEqual(["OCT-01-CASH"]);
  });

  it("returns no rows, not an error, when nothing matches", async () => {
    expect(await exportFor({ query: "nothing-matches" })).toEqual({ status: "ok", rows: [] });
  });
});

describe("row cap", () => {
  async function seedMany(count: number) {
    const base = Date.now();
    await db.sale.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        tenantId: T,
        storeId: IDS.storeA,
        billNumber: `BULK-${String(i).padStart(6, "0")}`,
        cashierUserId: IDS.ownerA,
        subtotalMinor: 95,
        taxMinor: 5,
        totalMinor: 100,
        paidMinor: 100,
        idempotencyKey: `bulk-${base}-${i}`,
      })),
    });
  }

  it("exports exactly the cap", async () => {
    await seedMany(SALES_EXPORT_MAX_ROWS);
    const res = await exportFor();
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.rows).toHaveLength(SALES_EXPORT_MAX_ROWS);
  });

  it("refuses one over the cap instead of truncating", async () => {
    await seedMany(SALES_EXPORT_MAX_ROWS + 1);
    expect(await exportFor()).toEqual({ status: "too_many_rows", total: SALES_EXPORT_MAX_ROWS + 1, max: SALES_EXPORT_MAX_ROWS });
  });

  it("counts only the filtered, scoped set toward the cap", async () => {
    await seedMany(SALES_EXPORT_MAX_ROWS + 1);
    const res = await exportFor({ query: "BULK-000001" });
    expect(res.status).toBe("ok");
  });
});
