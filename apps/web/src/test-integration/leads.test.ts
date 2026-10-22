import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import { createLead, listLeads, moveLeadStage, updateLead } from "@/server/b2b/leads";

/** B2B lead pipeline: validation, stage moves, tenant isolation and audit. */

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});

afterAll(async () => {
  await resetDatabase();
});

const base = { tenantId: IDS.tenantA, actorUserId: IDS.ownerA };

describe("lead pipeline", () => {
  it("creates a lead at NEW with an audit row", async () => {
    const res = await createLead({ ...base, input: { company: " Mehta Garments ", city: "Jaipur" } });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.lead).toMatchObject({ company: "Mehta Garments", city: "Jaipur", stage: "NEW" });
    expect(await db.auditLog.count({ where: { action: "lead.created", tenantId: IDS.tenantA } })).toBe(1);
  });

  it("rejects a blank company and an unknown stage", async () => {
    expect(await createLead({ ...base, input: { company: " " } })).toMatchObject({
      status: "validation_error",
      field: "company",
    });
    expect(await createLead({ ...base, input: { company: "X Co", stage: "PAID" } })).toMatchObject({
      status: "validation_error",
      field: "stage",
    });
    expect(await db.lead.count()).toBe(0);
  });

  it("moves a lead between stages and refuses an invalid stage", async () => {
    const res = await createLead({ ...base, input: { company: "Stage Co" } });
    if (res.status !== "ok") throw new Error("seed failed");
    expect(await moveLeadStage({ ...base, leadId: res.lead.id, stage: "QUALIFIED" })).toEqual({ status: "ok" });
    expect(await moveLeadStage({ ...base, leadId: res.lead.id, stage: "PAID" })).toEqual({ status: "invalid_stage" });
    expect((await db.lead.findUniqueOrThrow({ where: { id: res.lead.id } })).stage).toBe("QUALIFIED");
  });

  it("never lists, edits or moves another tenant's lead", async () => {
    const b = await createLead({ tenantId: IDS.tenantB, actorUserId: IDS.ownerB, input: { company: "B Lead" } });
    if (b.status !== "ok") throw new Error("seed failed");
    expect(await listLeads({ tenantId: IDS.tenantA })).toEqual([]);
    expect((await updateLead({ ...base, leadId: b.lead.id, input: { company: "Taken" } })).status).toBe("not_found");
    expect(await moveLeadStage({ ...base, leadId: b.lead.id, stage: "WON" })).toEqual({ status: "not_found" });
    expect(await db.lead.findUniqueOrThrow({ where: { id: b.lead.id } })).toMatchObject({
      company: "B Lead",
      stage: "NEW",
    });
  });

  it("searches by company, contact and city", async () => {
    await createLead({ ...base, input: { company: "Alpha Traders", contactName: "Ravi", city: "Pune" } });
    await createLead({ ...base, input: { company: "Beta Exports" } });
    expect((await listLeads({ tenantId: IDS.tenantA, query: "ravi" })).map((l) => l.company)).toEqual(["Alpha Traders"]);
    expect((await listLeads({ tenantId: IDS.tenantA, query: "pune" })).map((l) => l.company)).toEqual(["Alpha Traders"]);
  });
});
