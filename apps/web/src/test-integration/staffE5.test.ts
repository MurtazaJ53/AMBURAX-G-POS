import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import { attendanceFlags, decideCorrection, punch, requestCorrection, roster } from "@/server/staff/attendance";
import { createShift, publishShifts, updateShift, PLAN_HORIZON_DAYS } from "@/server/staff/shiftPlans";
import { decideLeave, istDate, requestLeave } from "@/server/staff/leave";

/** E5 (owner 2026-10-14): attendance flags, approved corrections and shift planning. */

const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const };
const staffA = { tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF" as const };
const HOUR = 3_600_000;

async function joinStore(role: string) {
  await db.storeMembership.create({ data: { tenantId: IDS.tenantA, userId: IDS.staffA, storeId: IDS.storeA, role } });
}

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});

afterAll(async () => {
  await resetDatabase();
});

describe("attendance flags", () => {
  const start = new Date("2026-10-10T04:30:00Z"); // 10:00 IST
  const shift = { startAt: start, endAt: new Date(start.getTime() + 9 * HOUR), breakMinutes: 60 };
  const after = new Date(start.getTime() + 10 * HOUR);
  const base = { graceMinutes: 10, halfDayPercent: 50, now: after };

  it("is late only past the grace period", () => {
    const at = (min: number) => [{ logType: "IN" as const, at: new Date(start.getTime() + min * 60_000) }, { logType: "OUT" as const, at: shift.endAt }];
    expect(attendanceFlags({ ...base, shift, punches: at(10), minutes: 470 })).toEqual([]);
    expect(attendanceFlags({ ...base, shift, punches: at(11), minutes: 469 })).toEqual(["LATE"]);
  });

  it("is a half day under half the paid time, absent with no punches, and unpaired punches need review", () => {
    const punches = [
      { logType: "IN" as const, at: start },
      { logType: "OUT" as const, at: new Date(start.getTime() + 3 * HOUR) },
    ];
    expect(attendanceFlags({ ...base, shift, punches, minutes: 180 })).toEqual(["HALF_DAY"]);
    expect(attendanceFlags({ ...base, shift, punches: [], minutes: 0 })).toEqual(["ABSENT"]);
    expect(attendanceFlags({ ...base, shift, punches: [punches[0]!], minutes: 0 })).toEqual(["NEEDS_REVIEW"]);
    // Still on shift: an open IN is fine.
    expect(attendanceFlags({ ...base, now: new Date(start.getTime() + HOUR), shift, punches: [punches[0]!], minutes: 60 })).toEqual([]);
  });
});

describe("attendance corrections", () => {
  it("someone else approves; the original punch is kept but voided", async () => {
    await joinStore("STORE_MANAGER");
    const wrongIn = new Date(Date.now() - 2 * HOUR);
    expect((await punch({ actor: owner, storeId: IDS.storeA, logType: "IN", now: wrongIn })).status).toBe("ok");
    const original = await db.staffCheckin.findFirstOrThrow({ where: { userId: IDS.ownerA } });

    const correctedAt = new Date(wrongIn.getTime() - 30 * 60_000);
    const req = await requestCorrection({
      actor: owner,
      storeId: IDS.storeA,
      userId: IDS.ownerA,
      logType: "IN",
      correctedAt,
      originalCheckinId: original.id,
      reason: "Arrived earlier, till was down",
    });
    expect(req.status).toBe("ok");
    const id = req.status === "ok" ? req.id! : "";

    // Not on your own punch.
    expect(await decideCorrection({ actor: owner, correctionId: id, approve: true, note: "fine" })).toMatchObject({ status: "conflict" });
    expect((await decideCorrection({ actor: staffA, correctionId: id, approve: true, note: "Checked CCTV" })).status).toBe("ok");
    // Decided once.
    expect(await decideCorrection({ actor: staffA, correctionId: id, approve: false, note: "again" })).toMatchObject({ status: "conflict" });

    const kept = await db.staffCheckin.findUniqueOrThrow({ where: { id: original.id } });
    expect(kept.at).toEqual(wrongIn);
    expect(kept.voidedByCorrectionId).toBe(id);
    const fixed = await db.staffCheckin.findFirstOrThrow({ where: { userId: IDS.ownerA, source: "CORRECTION" } });
    expect(fixed.at).toEqual(correctedAt);
  });

  it("staff can't ask on someone else's behalf or decide, and nothing changes until approved", async () => {
    await joinStore("SALES_ASSOCIATE");
    const req = await requestCorrection({
      actor: staffA,
      storeId: IDS.storeA,
      userId: IDS.ownerA,
      logType: "IN",
      correctedAt: new Date(Date.now() - HOUR),
      reason: "for the boss",
    });
    expect(req.status).toBe("forbidden");

    const own = await requestCorrection({
      actor: staffA,
      storeId: IDS.storeA,
      userId: IDS.staffA,
      logType: "OUT",
      correctedAt: new Date(Date.now() - HOUR),
      reason: "Forgot to clock out",
    });
    expect(own.status).toBe("ok");
    expect(await db.staffCheckin.count()).toBe(0);
    const id = own.status === "ok" ? own.id! : "";
    expect((await decideCorrection({ actor: staffA, correctionId: id, approve: true, note: "mine" })).status).toBe("forbidden");
  });

  it("refuses future times and times over 31 days back", async () => {
    await joinStore("SALES_ASSOCIATE");
    const ask = (correctedAt: Date) =>
      requestCorrection({ actor: staffA, storeId: IDS.storeA, userId: IDS.staffA, logType: "IN", correctedAt, reason: "test" });
    expect((await ask(new Date(Date.now() + HOUR))).status).toBe("validation_error");
    expect((await ask(new Date(Date.now() - 32 * 24 * HOUR))).status).toBe("validation_error");
  });
});

describe("shift planning", () => {
  const tomorrow = () => new Date(Date.now() + 24 * HOUR);
  const plan = (startAt: Date, hours = 8, actor: typeof owner | typeof staffA = owner) =>
    createShift({ actor, storeId: IDS.storeA, userId: IDS.staffA, startAt, endAt: new Date(startAt.getTime() + hours * HOUR), breakMinutes: 30 });

  it("refuses double-booking, past the horizon and non-managers", async () => {
    await joinStore("SALES_ASSOCIATE");
    const t = tomorrow();
    expect((await plan(t)).status).toBe("ok");
    expect(await plan(new Date(t.getTime() + 4 * HOUR))).toMatchObject({ status: "validation_error" });
    expect(await plan(new Date(Date.now() + (PLAN_HORIZON_DAYS + 1) * 24 * HOUR))).toMatchObject({ status: "validation_error" });
    expect(await plan(new Date(t.getTime() + 48 * HOUR), 17)).toMatchObject({ status: "validation_error" });
    expect((await plan(new Date(t.getTime() + 48 * HOUR), 8, staffA)).status).toBe("forbidden");
  });

  it("drafts are hidden from attendance until published; later changes are flagged", async () => {
    await joinStore("SALES_ASSOCIATE");
    const t = tomorrow();
    const created = await plan(t);
    const id = created.status === "ok" ? created.id! : "";
    const day = new Date(t.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const row = async () => (await roster({ tenantId: IDS.tenantA, storeId: IDS.storeA, date: day, onlyUserId: IDS.staffA }))[0];
    expect((await row())!.shift).toBeNull();

    expect(await publishShifts({ actor: owner, storeId: IDS.storeA })).toEqual({ status: "ok", published: 1 });
    expect((await row())!.shift?.changedAfterPublishAt).toBeNull();

    expect((await updateShift({ actor: owner, shiftId: id, startAt: t, endAt: new Date(t.getTime() + 6 * HOUR), breakMinutes: 0 })).status).toBe("ok");
    expect((await row())!.shift?.changedAfterPublishAt).toBeInstanceOf(Date);
  });
});

describe("leave blocks shift planning", () => {
  it("another manager approves; approved full days refuse a shift, pending ones don't", async () => {
    await joinStore("SALES_ASSOCIATE");
    const t = new Date(Date.now() + 3 * 24 * HOUR);
    const day = istDate(t);
    const asked = await requestLeave({ actor: staffA, storeId: IDS.storeA, userId: IDS.staffA, kind: "LEAVE", fromDate: day, toDate: day, reason: "Family function" });
    expect(asked.status).toBe("ok");
    const id = asked.status === "ok" ? asked.id! : "";
    // Same dates twice is refused; nobody decides their own.
    expect((await requestLeave({ actor: staffA, storeId: IDS.storeA, userId: IDS.staffA, kind: "UNAVAILABLE", fromDate: day, toDate: day, reason: "again" })).status).toBe("conflict");
    expect((await decideLeave({ actor: staffA, leaveId: id, approve: true, note: "mine" })).status).toBe("forbidden");

    const shift = (start: Date) =>
      createShift({ actor: owner, storeId: IDS.storeA, userId: IDS.staffA, startAt: start, endAt: new Date(start.getTime() + 4 * HOUR), breakMinutes: 0 });
    const noon = new Date(`${day}T12:00:00+05:30`);
    // While pending, a shift on that day exists, so approval is refused until it's moved.
    const planned = await shift(noon);
    expect(planned.status).toBe("ok");
    expect(await decideLeave({ actor: owner, leaveId: id, approve: true, note: "Looks fine" })).toMatchObject({ status: "conflict" });
    await db.shiftPlan.updateMany({ data: { status: "CANCELLED" } });
    expect((await decideLeave({ actor: owner, leaveId: id, approve: true, note: "Enjoy" })).status).toBe("ok");

    expect(await shift(noon)).toMatchObject({ status: "validation_error", reason: expect.stringContaining("approved leave") });
    expect((await shift(new Date(noon.getTime() + 24 * HOUR))).status).toBe("ok");
  });

  it("half day is one date only, and dates must be in order", async () => {
    await joinStore("SALES_ASSOCIATE");
    const ask = (fromDate: string, toDate: string, halfDay = false) =>
      requestLeave({ actor: staffA, storeId: IDS.storeA, userId: IDS.staffA, kind: "LEAVE", fromDate, toDate, halfDay, reason: "test" });
    expect((await ask("2026-12-02", "2026-12-01")).status).toBe("validation_error");
    expect((await ask("2026-12-01", "2026-12-02", true)).status).toBe("validation_error");
    expect((await ask("2026-12-01", "2026-12-01", true)).status).toBe("ok");
  });
});
