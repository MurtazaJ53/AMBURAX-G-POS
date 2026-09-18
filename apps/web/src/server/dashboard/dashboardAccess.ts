/**
 * Who sees which parts of the dashboard.
 *
 * This is a *presentation* rule, and the distinction matters enough to state at the top of
 * the file: hiding the analytics row from a cashier is a judgement about what is useful on
 * their screen, not a security control. The figures behind it are the cashier's own store's
 * takings, which they can already see one bill at a time at the till. Every query these
 * decisions gate is separately scoped to the caller's resolved tenant and store on the
 * server, and the trend endpoint re-resolves the session on every request. Nothing here is
 * load-bearing for isolation — remove this file and no tenant boundary moves.
 *
 * Kept out of the component tree so the rules can be tested as data, and out of
 * `dashboardTransforms` because they are policy rather than arithmetic.
 */

export interface DashboardViewer {
  tenantRole: "OWNER" | "STAFF";
  /** Null when the user holds no membership in this store — possible for a tenant OWNER. */
  membershipRole: string | null;
}

/**
 * Whether to show the day's analytics — the trend, the category ranking, the payment split.
 *
 * An owner sees their business. A manager sees the shop they run. An accountant needs the
 * money view by definition. A cashier and a sales associate get the operational half of the
 * screen instead: what is selling, what is thin on the shelf, and what has just been rung up,
 * which is what their shift actually turns on.
 */
export function canViewStoreAnalytics(viewer: DashboardViewer): boolean {
  if (viewer.tenantRole === "OWNER") return true;
  return (
    viewer.membershipRole === "STORE_MANAGER" ||
    viewer.membershipRole === "ACCOUNTANT" ||
    viewer.membershipRole === "INVENTORY_MANAGER"
  );
}

/**
 * Whether to show who is on shift and how the tills are running.
 *
 * Staffing is a supervisory concern; an inventory manager or accountant has no call on it,
 * which is why this is a narrower set than the analytics rule rather than the same one.
 */
export function canViewShiftActivity(viewer: DashboardViewer): boolean {
  return viewer.tenantRole === "OWNER" || viewer.membershipRole === "STORE_MANAGER";
}

/**
 * Whether the stock signal is worth the space for this viewer.
 *
 * Everyone on a shop floor benefits from knowing what has run out, so this is deliberately
 * open — it exists as a named rule rather than an unconditional render so that a future
 * capability with no stock at all has one place to turn it off.
 */
export function canViewStockSignal(viewer: DashboardViewer): boolean {
  void viewer;
  return true;
}
