import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS, SEEDED_STOCK } from "./db";
import { cancelTransfer, receiveTransfer, sendTransfer } from "@/server/inventory/stockTransfers";
import { findProjectionMismatches } from "@/server/inventory/stockLedger";

/** Stock transfers between stores (screens 28-29), against real PostgreSQL. */

const STORE_A2 = "s-aaaaaaaaaaaaaaaaaaaaaaa2";
const VARIANT = COMMERCE_IDS.variantA1;
const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const };
let sku = "";

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  const storeA = await db.store.findUniqueOrThrow({ where: { id: IDS.storeA } });
  await db.store.create({
    data: {
      id: STORE_A2,
      tenantId: IDS.tenantA,
      name: "MG Road",
      code: "ST-002",
      currency: storeA.currency,
      addressLine: "1 MG Rd",
      city: "Bengaluru",
      state: "Karnataka",
    },
  });
  await db.stockLevel.updateMany({ where: { storeId: IDS.storeA, variantId: VARIANT }, data: { avgCostMinor: 60_000 } });
  sku = (await db.productVariant.findUniqueOrThrow({ where: { id: VARIANT } })).sku;
});

afterAll(async () => {
  await resetDatabase();
});

const level = async (storeId: string) =>
  db.stockLevel.findFirst({ where: { storeId, variantId: VARIANT }, select: { quantity: true, avgCostMinor: true } });

function send(quantity: number, extra: Partial<Parameters<typeof sendTransfer>[0]> = {}) {
  return sendTransfer({
    actor: owner,
    fromStoreId: IDS.storeA,
    toStoreId: STORE_A2,
    lines: [{ sku, quantity }],
    idempotencyKey: randomUUID(),
    ...extra,
  });
}

describe("stock transfers", () => {
  it("takes stock out on send and puts what arrived in on receive, at the carried cost", async () => {
    const sent = await send(4);
    expect(sent).toMatchObject({ status: "ok", duplicate: false });
    if (sent.status !== "ok") return;
    expect((await level(IDS.storeA))?.quantity).toBe(SEEDED_STOCK.variantA1 - 4);
    expect(await level(STORE_A2)).toBeNull();

    const got = await receiveTransfer({ actor: owner, transferId: sent.transferId });
    expect(got).toEqual({ status: "ok", shortUnits: 0 });
    expect(await level(STORE_A2)).toEqual({ quantity: 4, avgCostMinor: 60_000 });
    expect((await db.stockTransfer.findUniqueOrThrow({ where: { id: sent.transferId } })).status).toBe("RECEIVED");
    expect(await findProjectionMismatches(db, IDS.tenantA)).toEqual([]);
  });

  it("records a shortfall instead of adding stock that did not arrive", async () => {
    const sent = await send(5);
    if (sent.status !== "ok") throw new Error("send failed");
    const line = await db.stockTransferLine.findFirstOrThrow({ where: { transferId: sent.transferId } });
    expect(await receiveTransfer({ actor: owner, transferId: sent.transferId, received: { [line.id]: 3 } })).toEqual({
      status: "ok",
      shortUnits: 2,
    });
    expect((await level(STORE_A2))?.quantity).toBe(3);
    expect((await db.stockTransferLine.findUniqueOrThrow({ where: { id: line.id } })).receivedQuantity).toBe(3);
    expect(await receiveTransfer({ actor: owner, transferId: sent.transferId, received: { [line.id]: 9 } })).toEqual({
      status: "not_in_transit",
    });
  });

  it("refuses to receive more than was sent", async () => {
    const sent = await send(2);
    if (sent.status !== "ok") throw new Error("send failed");
    const line = await db.stockTransferLine.findFirstOrThrow({ where: { transferId: sent.transferId } });
    expect(
      (await receiveTransfer({ actor: owner, transferId: sent.transferId, received: { [line.id]: 3 } })).status,
    ).toBe("validation_error");
    expect(await level(STORE_A2)).toBeNull();
  });

  it("cancelling puts every unit back, and a cancelled transfer cannot be received", async () => {
    const sent = await send(4);
    if (sent.status !== "ok") throw new Error("send failed");
    expect(await cancelTransfer({ actor: owner, transferId: sent.transferId })).toEqual({ status: "ok" });
    expect((await level(IDS.storeA))?.quantity).toBe(SEEDED_STOCK.variantA1);
    expect(await receiveTransfer({ actor: owner, transferId: sent.transferId })).toEqual({ status: "not_in_transit" });
    expect(await findProjectionMismatches(db, IDS.tenantA)).toEqual([]);
  });

  it("checks rights in the right store, refuses another tenant's store, and a retry sends once", async () => {
    await db.storeMembership.create({
      data: { tenantId: IDS.tenantA, userId: IDS.staffA, storeId: IDS.storeA, role: "CASHIER" },
    });
    const cashier = { tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF" as const };
    expect(await send(1, { actor: cashier })).toEqual({ status: "forbidden" });
    expect((await send(1, { toStoreId: IDS.storeB })).status).toBe("validation_error");
    expect((await send(1, { toStoreId: IDS.storeA })).status).toBe("validation_error");

    const key = randomUUID();
    const a = await send(1, { idempotencyKey: key });
    const b = await send(1, { idempotencyKey: key });
    expect(b).toMatchObject({ status: "ok", duplicate: true });
    expect(a.status === "ok" && b.status === "ok" && a.transferId === b.transferId).toBe(true);
    expect((await level(IDS.storeA))?.quantity).toBe(SEEDED_STOCK.variantA1 - 1);
  });

  it("two people receiving at once add the stock only once", async () => {
    const sent = await send(3);
    if (sent.status !== "ok") throw new Error("send failed");
    const results = await Promise.all([
      receiveTransfer({ actor: owner, transferId: sent.transferId }),
      receiveTransfer({ actor: owner, transferId: sent.transferId }),
    ]);
    expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
    expect((await level(STORE_A2))?.quantity).toBe(3);
  });
});
