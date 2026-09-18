import { describe, expect, test } from "vitest";
import {
  canViewShiftActivity,
  canViewStockSignal,
  canViewStoreAnalytics,
  type DashboardViewer,
} from "@/server/dashboard/dashboardAccess";

/**
 * The dashboard's role rules.
 *
 * Worth testing as data because they are easy to get subtly wrong in JSX — an `||` in the
 * wrong place hands a cashier the whole business's analytics, and nothing about the rendered
 * page would look broken. These assertions are about what each role sees, not about
 * isolation: the queries behind every one of these widgets are scoped to the caller's own
 * tenant and store regardless of what this file returns.
 */

const viewer = (
  tenantRole: DashboardViewer["tenantRole"],
  membershipRole: string | null,
): DashboardViewer => ({ tenantRole, membershipRole });

describe("canViewStoreAnalytics", () => {
  test("an owner sees analytics even with no membership in the store", () => {
    // A tenant owner may hold no StoreMembership row at all; that must not lock them out of
    // their own business's figures.
    expect(canViewStoreAnalytics(viewer("OWNER", null))).toBe(true);
  });

  test("managers, accountants and inventory managers see analytics", () => {
    expect(canViewStoreAnalytics(viewer("STAFF", "STORE_MANAGER"))).toBe(true);
    expect(canViewStoreAnalytics(viewer("STAFF", "ACCOUNTANT"))).toBe(true);
    expect(canViewStoreAnalytics(viewer("STAFF", "INVENTORY_MANAGER"))).toBe(true);
  });

  test("a cashier or sales associate gets the operational view instead", () => {
    expect(canViewStoreAnalytics(viewer("STAFF", "CASHIER"))).toBe(false);
    expect(canViewStoreAnalytics(viewer("STAFF", "SALES_ASSOCIATE"))).toBe(false);
  });

  test("staff with no membership and unknown roles are refused", () => {
    expect(canViewStoreAnalytics(viewer("STAFF", null))).toBe(false);
    expect(canViewStoreAnalytics(viewer("STAFF", "SOMETHING_NEW"))).toBe(false);
  });
});

describe("canViewShiftActivity", () => {
  test("only an owner or the store manager sees who is on shift", () => {
    expect(canViewShiftActivity(viewer("OWNER", null))).toBe(true);
    expect(canViewShiftActivity(viewer("STAFF", "STORE_MANAGER"))).toBe(true);
  });

  test("it is narrower than the analytics rule, not the same one", () => {
    // An accountant sees the money and not the roster; if these two rules ever collapse into
    // one, this is the assertion that notices.
    expect(canViewStoreAnalytics(viewer("STAFF", "ACCOUNTANT"))).toBe(true);
    expect(canViewShiftActivity(viewer("STAFF", "ACCOUNTANT"))).toBe(false);
    expect(canViewShiftActivity(viewer("STAFF", "INVENTORY_MANAGER"))).toBe(false);
    expect(canViewShiftActivity(viewer("STAFF", "CASHIER"))).toBe(false);
  });
});

describe("canViewStockSignal", () => {
  test("everyone on the shop floor sees what has run out", () => {
    expect(canViewStockSignal(viewer("STAFF", "CASHIER"))).toBe(true);
    expect(canViewStockSignal(viewer("STAFF", null))).toBe(true);
    expect(canViewStockSignal(viewer("OWNER", null))).toBe(true);
  });
});
