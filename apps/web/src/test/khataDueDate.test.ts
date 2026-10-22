import { describe, expect, it } from "vitest";
import { calculateInvoiceDueDate, compareSalesForFifoRepayment, addCalendarDaysInTimeZone } from "@/server/khata/dueDate";

describe("Khata Due Date and FIFO Invariants", () => {
  const baseDate = new Date("2026-10-12T10:00:00.000Z");

  it("calculates due date with positive customer terms", () => {
    const result = calculateInvoiceDueDate({
      completedAt: baseDate,
      customerPaymentTermsDays: 15,
      companyDefaultTermsDays: 30, // customer override takes precedence
    });

    expect(result.effectiveTermsDays).toBe(15);
    const expectedDue = addCalendarDaysInTimeZone(baseDate, 15, "Asia/Kolkata");
    expect(result.dueDate.toISOString()).toBe(expectedDue.toISOString());
  });

  it("handles month and leap year boundaries properly via calendar day addition", () => {
    // Leap year Feb 28 -> Mar 1 (1 day in 2024 leap year)
    const feb28Leap = new Date("2024-02-28T12:00:00.000Z");
    const resultLeap = calculateInvoiceDueDate({
      completedAt: feb28Leap,
      customerPaymentTermsDays: 1,
    });
    // In leap year 2024, Feb has 29 days
    const feb29 = new Date("2024-02-29T12:00:00.000Z");
    expect(resultLeap.dueDate.toISOString()).toBe(feb29.toISOString());

    // Non-leap year 2023 Feb 28 + 1 day -> Mar 1
    const feb28NonLeap = new Date("2023-02-28T12:00:00.000Z");
    const resultNonLeap = calculateInvoiceDueDate({
      completedAt: feb28NonLeap,
      customerPaymentTermsDays: 1,
    });
    const mar1 = new Date("2023-03-01T12:00:00.000Z");
    expect(resultNonLeap.dueDate.toISOString()).toBe(mar1.toISOString());
  });

  it("calculates due date with zero customer terms (due immediately)", () => {
    const result = calculateInvoiceDueDate({
      completedAt: baseDate,
      customerPaymentTermsDays: 0,
      companyDefaultTermsDays: 30, // customer explicit 0 overrides company default
    });

    expect(result.effectiveTermsDays).toBe(0);
    expect(result.dueDate.toISOString()).toBe(baseDate.toISOString());
  });

  it("inherits company default when customer terms are null", () => {
    const result = calculateInvoiceDueDate({
      completedAt: baseDate,
      customerPaymentTermsDays: null,
      companyDefaultTermsDays: 30,
    });

    expect(result.effectiveTermsDays).toBe(30);
    const expectedDue = addCalendarDaysInTimeZone(baseDate, 30, "Asia/Kolkata");
    expect(result.dueDate.toISOString()).toBe(expectedDue.toISOString());
  });

  it("inherits company default when customer terms are undefined", () => {
    const result = calculateInvoiceDueDate({
      completedAt: baseDate,
      customerPaymentTermsDays: undefined,
      companyDefaultTermsDays: 45,
    });

    expect(result.effectiveTermsDays).toBe(45);
    const expectedDue = addCalendarDaysInTimeZone(baseDate, 45, "Asia/Kolkata");
    expect(result.dueDate.toISOString()).toBe(expectedDue.toISOString());
  });

  it("falls back to 0 days when customer terms are null and company default is not set", () => {
    const result = calculateInvoiceDueDate({
      completedAt: baseDate,
      customerPaymentTermsDays: null,
      companyDefaultTermsDays: null,
    });

    expect(result.effectiveTermsDays).toBe(0);
    expect(result.dueDate.toISOString()).toBe(baseDate.toISOString());
  });

  it("orders sales by FIFO rules: due date ASC, completedAt ASC, id ASC", () => {
    const sales = [
      {
        id: "sale-3",
        dueDateSnapshot: new Date("2026-10-20T10:00:00.000Z"),
        completedAt: new Date("2026-10-05T10:00:00.000Z"),
      },
      {
        id: "sale-1",
        dueDateSnapshot: new Date("2026-10-15T10:00:00.000Z"),
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      },
      {
        id: "sale-2",
        dueDateSnapshot: new Date("2026-10-15T10:00:00.000Z"),
        completedAt: new Date("2026-10-02T10:00:00.000Z"),
      },
      {
        id: "sale-4-b",
        dueDateSnapshot: new Date("2026-10-25T10:00:00.000Z"),
        completedAt: new Date("2026-10-10T10:00:00.000Z"),
      },
      {
        id: "sale-4-a",
        dueDateSnapshot: new Date("2026-10-25T10:00:00.000Z"),
        completedAt: new Date("2026-10-10T10:00:00.000Z"),
      },
    ];

    sales.sort(compareSalesForFifoRepayment);

    expect(sales.map((s) => s.id)).toEqual([
      "sale-1", // earlier due date
      "sale-2", // same due date as sale-1, earlier completedAt
      "sale-3", // due Oct 20
      "sale-4-a", // due Oct 25, completed Oct 10, tie-breaker 'sale-4-a' < 'sale-4-b'
      "sale-4-b",
    ]);
  });
});
