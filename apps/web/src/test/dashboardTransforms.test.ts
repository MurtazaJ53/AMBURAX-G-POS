import { describe, expect, test } from "vitest";
import {
  bucketByDay,
  bucketByHour,
  formatAxisMoney,
  formatStoreTime,
  formatTradingDay,
  greetingFor,
  initialsOf,
  isTrendRange,
  paymentMethodLabel,
  percentChange,
  seriesColour,
  shiftStoreDay,
  startOfStoreDay,
  storeDateKey,
  storeHour,
  toShares,
  trendRangeDays,
} from "@/server/dashboard/dashboardTransforms";

/**
 * The dashboard's arithmetic, and above all its timezone behaviour.
 *
 * India runs at UTC+05:30, which means the last five and a half hours of every Indian
 * trading day fall on the *next* UTC date. Any bucketing that reached for `getUTCHours()` or
 * `getDate()` would therefore be wrong every single evening — the busiest part of a retail
 * day — while looking perfectly correct in a morning smoke test. These tests pin the
 * boundary from both sides so that regression cannot pass.
 */

/** 2026-09-18T18:30:00Z is exactly midnight on 19 September in Kolkata. */
const IST_MIDNIGHT_19TH = new Date("2026-09-18T18:30:00.000Z");
/** One second earlier is still the 18th, at 23:59:59. */
const IST_LAST_SECOND_18TH = new Date("2026-09-18T18:29:59.000Z");
/** 09:15 on the 19th in Kolkata. */
const IST_MORNING_19TH = new Date("2026-09-19T03:45:00.000Z");
/** 20:00 on the 19th in Kolkata — the case a UTC-based bucket would file under the 20th. */
const IST_EVENING_19TH = new Date("2026-09-19T14:30:00.000Z");

describe("store-day boundaries", () => {
  test("midnight in Kolkata resolves to the UTC instant 18:30 the previous day", () => {
    expect(startOfStoreDay(IST_MIDNIGHT_19TH).toISOString()).toBe("2026-09-18T18:30:00.000Z");
  });

  test("an instant one second before midnight belongs to the previous trading day", () => {
    expect(startOfStoreDay(IST_LAST_SECOND_18TH).toISOString()).toBe("2026-09-17T18:30:00.000Z");
    expect(storeDateKey(IST_LAST_SECOND_18TH)).toBe("2026-09-18");
  });

  test("late evening still belongs to the same trading day, though UTC has rolled over", () => {
    const lateNight = new Date("2026-09-19T18:15:00.000Z"); // 23:45 IST on the 19th
    expect(lateNight.getUTCDate()).toBe(19);
    expect(storeDateKey(lateNight)).toBe("2026-09-19");
    expect(startOfStoreDay(lateNight).toISOString()).toBe("2026-09-18T18:30:00.000Z");

    const justAfter = new Date("2026-09-19T18:31:00.000Z"); // 00:01 IST on the 20th
    expect(storeDateKey(justAfter)).toBe("2026-09-20");
  });

  test("storeHour reports Kolkata hours, never UTC hours", () => {
    expect(storeHour(IST_MIDNIGHT_19TH)).toBe(0);
    expect(IST_MIDNIGHT_19TH.getUTCHours()).toBe(18);

    expect(storeHour(IST_LAST_SECOND_18TH)).toBe(23);
    expect(storeHour(IST_MORNING_19TH)).toBe(9);
    expect(storeHour(IST_EVENING_19TH)).toBe(20);
  });

  test("shiftStoreDay moves whole days and stays on the boundary", () => {
    const today = startOfStoreDay(IST_MORNING_19TH);
    expect(shiftStoreDay(today, 1).toISOString()).toBe("2026-09-17T18:30:00.000Z");
    expect(shiftStoreDay(today, -1).toISOString()).toBe("2026-09-19T18:30:00.000Z");
    expect(shiftStoreDay(today, 7).toISOString()).toBe("2026-09-11T18:30:00.000Z");
  });
});

describe("bucketByHour", () => {
  const dayStart = startOfStoreDay(IST_MORNING_19TH);

  test("files each sale under its Kolkata hour", () => {
    const points = bucketByHour(
      [
        { completedAt: IST_MIDNIGHT_19TH, totalMinor: 1000 },
        { completedAt: IST_MORNING_19TH, totalMinor: 2500 },
        { completedAt: IST_EVENING_19TH, totalMinor: 700 },
      ],
      dayStart,
    );

    expect(points).toHaveLength(24);
    expect(points[0]).toMatchObject({ label: "00:00", salesMinor: 1000, billCount: 1 });
    expect(points[9]).toMatchObject({ label: "09:00", salesMinor: 2500, billCount: 1 });
    expect(points[20]).toMatchObject({ label: "20:00", salesMinor: 700, billCount: 1 });
  });

  test("an evening sale does not leak into the following day's chart", () => {
    // 20:00 IST on the 19th is 14:30Z on the 19th. Bucketed against the 20th it must not
    // appear at all — the failure mode a UTC-hour implementation produces.
    const nextDay = shiftStoreDay(dayStart, -1);
    const points = bucketByHour([{ completedAt: IST_EVENING_19TH, totalMinor: 700 }], nextDay);
    expect(points.every((point) => point.billCount === 0)).toBe(true);
  });

  test("empty hours are kept so the axis does not compress", () => {
    const points = bucketByHour([], dayStart);
    expect(points).toHaveLength(24);
    expect(points.map((point) => point.salesMinor)).toEqual(Array(24).fill(0));
    expect(points[0]!.startsAt.toISOString()).toBe("2026-09-18T18:30:00.000Z");
    expect(points[23]!.startsAt.toISOString()).toBe("2026-09-19T17:30:00.000Z");
  });

  test("honours a narrowed hour window", () => {
    const points = bucketByHour([], dayStart, { fromHour: 9, toHour: 12 });
    expect(points.map((point) => point.label)).toEqual(["09:00", "10:00", "11:00", "12:00"]);
  });

  test("two sales in the same hour accumulate", () => {
    const points = bucketByHour(
      [
        { completedAt: IST_MORNING_19TH, totalMinor: 1500 },
        { completedAt: new Date("2026-09-19T04:00:00.000Z"), totalMinor: 500 },
      ],
      dayStart,
    );
    expect(points[9]).toMatchObject({ salesMinor: 2000, billCount: 2 });
  });
});

describe("bucketByDay", () => {
  const lastDay = startOfStoreDay(IST_MORNING_19TH);

  test("returns the requested number of days, oldest first", () => {
    const points = bucketByDay([], lastDay, 7);
    expect(points).toHaveLength(7);
    // Asserted on the bucket's instant rather than its label: the label is locale-formatted
    // and ICU spells the month "Sep" or "Sept" depending on the Node build, which is not a
    // property this function is responsible for.
    expect(storeDateKey(points[0]!.startsAt)).toBe("2026-09-13");
    expect(storeDateKey(points[6]!.startsAt)).toBe("2026-09-19");
    expect(points[0]!.label).toMatch(/^13 Sept?$/);
  });

  test("a sale one minute into a trading day lands on that day, not the UTC one", () => {
    // 2026-09-12T18:31Z is 00:01 IST on the 13th. In UTC it is still the 12th.
    const justAfterMidnight = new Date("2026-09-12T18:31:00.000Z");
    expect(justAfterMidnight.getUTCDate()).toBe(12);

    const points = bucketByDay([{ completedAt: justAfterMidnight, totalMinor: 4200 }], lastDay, 7);
    expect(points[0]).toMatchObject({ salesMinor: 4200, billCount: 1 });
    expect(storeDateKey(points[0]!.startsAt)).toBe("2026-09-13");
  });

  test("sales outside the window are ignored rather than folded into the edges", () => {
    const tooOld = new Date("2026-09-01T06:00:00.000Z");
    const points = bucketByDay([{ completedAt: tooOld, totalMinor: 999 }], lastDay, 7);
    expect(points.every((point) => point.salesMinor === 0)).toBe(true);
  });
});

describe("percentChange", () => {
  test("computes movement against a real previous period", () => {
    expect(percentChange(12000, 10000)).toBe(20);
    expect(percentChange(8000, 10000)).toBe(-20);
    expect(percentChange(10000, 10000)).toBe(0);
  });

  test("is null when the previous period had nothing to compare against", () => {
    // The point of the whole function: no comparison is not the same as +100%.
    expect(percentChange(5000, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
    expect(percentChange(5000, -1)).toBeNull();
  });

  test("rounds to one decimal", () => {
    expect(percentChange(1234, 1000)).toBe(23.4);
  });
});

describe("toShares", () => {
  test("ranks by amount and computes each share of the rows given", () => {
    const { rows, totalMinor } = toShares([
      { key: "a", label: "Shirts", amountMinor: 5000 },
      { key: "b", label: "Trousers", amountMinor: 3000 },
      { key: "c", label: "Caps", amountMinor: 2000 },
    ]);

    expect(totalMinor).toBe(10000);
    expect(rows.map((row) => row.label)).toEqual(["Shirts", "Trousers", "Caps"]);
    expect(rows.map((row) => row.sharePct)).toEqual([50, 30, 20]);
  });

  test("shares are null rather than zero when nothing sold", () => {
    const { rows } = toShares([{ key: "a", label: "Shirts", amountMinor: 0 }]);
    expect(rows[0]!.sharePct).toBeNull();
  });

  test("applies a limit after ranking, not before", () => {
    const { rows, totalMinor } = toShares(
      [
        { key: "a", label: "Small", amountMinor: 100 },
        { key: "b", label: "Large", amountMinor: 900 },
      ],
      { limit: 1 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("Large");
    // The denominator still covers every row, so a limited list does not read as 100%.
    expect(totalMinor).toBe(1000);
    expect(rows[0]!.sharePct).toBe(90);
  });
});

describe("formatting", () => {
  test("clock times render in store time", () => {
    expect(formatStoreTime(IST_MORNING_19TH)).toBe("09:15");
    expect(formatStoreTime(IST_MIDNIGHT_19TH)).toBe("00:00");
  });

  test("the trading day renders in store time", () => {
    expect(formatTradingDay(IST_MIDNIGHT_19TH)).toContain("19 Sep");
  });

  test("axis money uses lakh and crore", () => {
    expect(formatAxisMoney(0)).toBe("₹0");
    expect(formatAxisMoney(50_000)).toBe("₹500");
    expect(formatAxisMoney(500_000)).toBe("₹5K");
    expect(formatAxisMoney(50_000_000)).toBe("₹5.0L");
    expect(formatAxisMoney(5_000_000_000)).toBe("₹5.0Cr");
  });

  test("greeting follows the store clock", () => {
    expect(greetingFor(new Date("2026-09-19T03:45:00.000Z"))).toBe("Good morning");
    expect(greetingFor(new Date("2026-09-19T09:00:00.000Z"))).toBe("Good afternoon");
    expect(greetingFor(new Date("2026-09-19T14:30:00.000Z"))).toBe("Good evening");
    // 18:30Z is midnight in the shop, which is "morning", not "evening".
    expect(greetingFor(IST_MIDNIGHT_19TH)).toBe("Good morning");
  });

  test("initials take the first and last name", () => {
    expect(initialsOf("Priya Nair")).toBe("PN");
    expect(initialsOf("  asha  kumari  devi ")).toBe("AD");
    expect(initialsOf("Ravi")).toBe("RA");
    expect(initialsOf("   ")).toBe("?");
  });

  test("payment methods get operator-facing names, unknown ones pass through", () => {
    expect(paymentMethodLabel("CASH")).toBe("Cash");
    expect(paymentMethodLabel("UPI")).toBe("UPI");
    expect(paymentMethodLabel("CARD")).toBe("Card");
    expect(paymentMethodLabel("WALLET")).toBe("WALLET");
  });

  test("series colours cycle rather than running out", () => {
    expect(seriesColour(0)).toBe(seriesColour(5));
    expect(seriesColour(1)).not.toBe(seriesColour(0));
  });
});

describe("trend ranges", () => {
  test("only the four known ranges are accepted", () => {
    expect(isTrendRange("today")).toBe(true);
    expect(isTrendRange("30d")).toBe(true);
    expect(isTrendRange("90d")).toBe(false);
    expect(isTrendRange(undefined)).toBe(false);
  });

  test("day spans match the labels", () => {
    expect(trendRangeDays("today")).toBe(1);
    expect(trendRangeDays("yesterday")).toBe(1);
    expect(trendRangeDays("7d")).toBe(7);
    expect(trendRangeDays("30d")).toBe(30);
  });
});
