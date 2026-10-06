# Integration Test Infrastructure — Root Cause and Fix

**Date:** 3 October 2026
**Commit:** `ed3af85` — `fix(test): stabilize integration database lifecycle`
**Branch:** `main` (parent `f168aca`)

**INTEGRATION INFRASTRUCTURE — FIXED**

---

## 1. Exact root cause

`resetDatabase()` in `apps/web/src/test-integration/db.ts` ran this from `beforeEach`, once per
test:

```sql
TRUNCATE TABLE <all 32 public tables> RESTART IDENTITY CASCADE
```

Measured directly against this project's Docker-for-Windows Postgres (`amburax_test`, warm, no
contention):

| Operation | Time |
| --- | ---: |
| `TRUNCATE` all 32 tables | **~1350 ms** |
| `TRUNCATE` all 32 tables, no `RESTART IDENTITY` | ~1200 ms |
| `TRUNCATE` **exactly one** table | **~1557 ms** |
| `DELETE` from all 32 tables, one transaction | **~25 ms** |
| `EXISTS` probe across all 32 tables | ~2 ms |
| `SELECT 1` (baseline) | ~4 ms |

The decisive measurement is the third row. **Truncating one table costs the same as truncating
thirty-two.** The cost is not row removal and does not scale with table count — it is a fixed
per-statement penalty. `TRUNCATE` rewrites each table's file and forces an fsync, and on a
virtiofs-backed Docker volume a single fsync costs over a second.

Two consequences follow, and they are the two reported symptoms.

### Why sequential execution "hung"

It never hung. It was doing ~1.35 s of fsync per test, 540 times:

```
540 tests × ~1.35 s ≈ 729 s   of a measured 934 s total  (≈ 78%)
```

Vitest's default reporter emits per *file*, not per test. With each file taking ~60 s, the
terminal showed `RUN v5.0.0 D:/G-POS/apps/web` and then nothing for minutes. Every observer —
and every CI timeout under ~16 minutes — read that as a hang.

Confirmed by bisection: a single file (`uom.test.ts`, 27 tests) took **56.48 s** and exited 0; a
pair including `dbUnavailable.test.ts` took **58.24 s** and exited 0. No stall, no leak, no
dangling promise, no deadlock — just the fixed penalty, repeated.

### Why parallel execution deadlocked (`40P01`)

`TRUNCATE` acquires `AccessExclusiveLock` on **every table it names**. Two workers each issuing a
32-table `TRUNCATE` acquire those 32 locks in whatever order their plans choose. Worker A holds
the lock on table *x* and waits for *y*; worker B holds *y* and waits for *x*. Postgres detects
the cycle and reports `40P01 deadlock detected`.

That is a property of the statement, not of the test content, which is why it could not be fixed
by retrying or reordering tests — and why the project had already been forced onto
`--no-file-parallelism`, trading the deadlock for the 15-minute runtime.

`DELETE` takes `RowExclusiveLock`, which does not self-conflict this way.

---

## 2. What was ruled out

Each hypothesis was tested, not assumed:

| Hypothesis | Verdict | Evidence |
| --- | --- | --- |
| Connections leaked / pool exhausted | No | `pg_stat_activity` on `amburax_test` showed zero stale connections before and after runs |
| `resetDatabase` waiting on a lock | No | Single-worker runs; `wait_event_type` null throughout |
| Prisma clients left open keeping the process alive | No | Every scoped run exited 0 on its own |
| `dbUnavailable.test.ts` poisoning the shared client | No | It builds its own throwaway `PrismaClient` against a dead port and disconnects it; adding it to a run cost ~2 s |
| A dangling promise in setup | No | Bisection reproduced the cost in the simplest possible run |
| Truncating only dirty tables would help | **No** | One table costs the same as 32 — the reason this fix is `DELETE` and not selective `TRUNCATE` |

---

## 3. The fix

### 3.1 `apps/web/src/test-integration/db.ts` — the reset helper

```ts
export async function resetDatabase(): Promise<void> {
  const tables = await publicTables();           // read from pg_tables once per process
  if (tables.length === 0) return;
  await db.$transaction([
    db.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
    ...tables.map((t) => db.$executeRawUnsafe(`DELETE FROM "public"."${t}"`)),
  ]);
}
```

Three points of equivalence with the `TRUNCATE` it replaces:

- **Foreign keys.** `SET LOCAL session_replication_role = replica` disables FK triggers for the
  duration of the transaction, so the deletes need no dependency ordering — exactly the property
  `CASCADE` was providing. `LOCAL` scopes it to the transaction, so it reverts on commit *and* on
  rollback; the session can never be left with FK enforcement off. Verified empirically: the role
  reads `origin` before and after, and FK-linked tenant/user/store rows are removed cleanly.
- **Identity sequences.** `RESTART IDENTITY` is not reproduced because there is nothing to
  restart: `autoincrement()` appears nowhere in `prisma/schema.prisma` across all 32 models, so
  the schema owns no identity sequences.
- **Scope.** `_prisma_migrations` is still excluded, so `prisma migrate status` continues to see a
  migrated database.

The table list is now cached per process. The schema cannot change mid-run, so the `pg_tables`
query was costing ~18 ms × every test for an answer that never varied.

### 3.2 `apps/web/vitest.integration.config.ts` — an invalid option

The config carried:

```ts
globalTeardown: ["./src/test-integration/globalTeardown.ts"],
```

**Vitest has no `globalTeardown` option.** It has `globalSetup?: string | string[]`, whose module
may export a `teardown` function (confirmed against the installed `vitest@5.0.0` type
definitions). The unknown key was ignored at runtime — so the file it named never executed — and
it failed `tsc` with `TS2769`, which is precisely why `npm run typecheck` was red.

Removed, together with the dead `globalTeardown.ts` it pointed at (untracked, never committed,
never executed). Nothing replaces it, deliberately: the hang it was written to solve was per-file
`db.$disconnect()` in `afterAll` closing the shared pool while later files still needed it, and
those calls are already gone. A global teardown could not have helped in any case — it runs in the
main process and would be disconnecting a different client instance from the worker's.

### 3.3 `apps/web/src/test-integration/sales.test.ts` — an impossible assertion

The `F11 Sales History & Analytics` case paid `CASH 1000 + UPI 1000` = 2 000 minor against a bill
of 100 000 minor (one `variantA1`, `priceMinor: 100_000`, confirmed by the existing assertion
`expect(result.sale.totalMinor).toBe(200_000)` for two of them). `createSale` correctly refused
with `validation_error: Insufficient payment`, so the test could never reach its assertions.

**Proven pre-existing, not caused by this fix:** the case was re-run against the original
`TRUNCATE`-based `resetDatabase` (via `git stash`) and failed identically with
`expected 'validation_error' to be 'ok'`.

Amounts corrected to `50_000 + 50_000`. The split itself — two methods, so the listed label reads
`CASH + UPI` — is unchanged.

### 3.4 Per-file connection hooks

The 17 other test files in this commit carry only the removal of `beforeAll(db.$connect)` /
`afterAll(db.$disconnect)` hooks (17 `$disconnect`, 5 `$connect`). With `isolate: false` all files
share one process and one client, so a per-file disconnect closed the pool out from under every
later file. This change was already staged in the working tree when this task began; it is
included here because it is part of the same lifecycle correction and is required for the suite to
run at all.

---

## 4. Before / after

| | Before | After |
| --- | --- | --- |
| `npm run test:integration` | 934 s, or `40P01 deadlock detected` in parallel | **109.86 s** |
| Test Files | 19 | **19 passed (19)** |
| Tests | 540 (1 failing) | **540 passed (540)** |
| Failed | 1 | **0** |
| Skipped | 0 | **0** |
| Exit code | 1 | **0** |
| `npm run typecheck` | `TS2769` (red) | **exit 0** |

Single-file comparison, same 27 tests in `uom.test.ts`: **56.48 s → 9.23 s** (6.1×).
Full suite: **934 s → 109.86 s** (8.5×).

### Proof the full suite exits 0

```
START 16:30:57
 Test Files  19 passed (19)
      Tests  540 passed (540)
   Duration  109.86s (tests 99%, transform 1%)
INTEGRATION_EXIT=0
END 16:32:50
```

### All five gates

| Command | Result | Exit |
| --- | --- | ---: |
| `npm run test` | 41 files, 581 passed (581), 0 failed, 0 skipped | **0** |
| `npm run test:integration` | 19 files, 540 passed (540), 0 failed, 0 skipped, 109.86 s | **0** |
| `npm run typecheck` | clean | **0** |
| `npm run lint` | 8 problems (0 errors, 8 warnings) | **0** |
| `npm run build` | `✓ Compiled successfully in 18.6s` | **0** |

The 8 lint warnings are all pre-existing `@next/next/no-img-element` in
`inventory/movements/page.tsx`, `inventory/page.tsx`, `InventoryDetailPanel.tsx` and
`sales/_components/SalesWorkspace.tsx` — none in a file this commit touches.

---

## 5. Regression

No production code was modified. The commit touches only `src/test-integration/**` and
`vitest.integration.config.ts`; no file under `src/app`, `src/server` or `src/components` is in
it, and nothing outside the test tree imports `test-integration/db.ts`.

F9 and F11 integration coverage still collects and executes, confirmed by name through
`vitest list`:

```
src/test-integration/sales.test.ts > Split Payments > Exactly matches total
src/test-integration/sales.test.ts > Split Payments > Insufficient sum fails
src/test-integration/sales.test.ts > Split Payments > Overpayment requires CASH
src/test-integration/sales.test.ts > Split Payments > Overpayment works with CASH
src/test-integration/sales.test.ts > F11 Sales History & Analytics > Lists split payments correctly and groups analytics by IST
```

No sales were created through the UI for this work; verification was confined to the
`amburax_test` database. The development database `amburax_identity` was never reset, reseeded or
written to.

---

## 6. Files changed

```
apps/web/src/test-integration/db.ts                      64 +++++++++++---   the fix
apps/web/vitest.integration.config.ts                    15 +++            invalid option removed
apps/web/src/test-integration/sales.test.ts              12 ++--           F11 amounts + lifecycle
apps/web/src/test-integration/address.test.ts             1 -              lifecycle hooks
apps/web/src/test-integration/capability.test.ts          8 ---                  "
apps/web/src/test-integration/catalogIsolation.test.ts    1 -                    "
apps/web/src/test-integration/inventory.test.ts           1 -                    "
apps/web/src/test-integration/onboardingResume.test.ts    1 -                    "
apps/web/src/test-integration/orders.test.ts              7 ---                  "
apps/web/src/test-integration/outbox.test.ts              1 -                    "
apps/web/src/test-integration/posDeviceCreate.test.ts     4 +-                   "
apps/web/src/test-integration/posDeviceLifecycle.test.ts  4 +-                   "
apps/web/src/test-integration/posDevices.test.ts          4 +-                   "
apps/web/src/test-integration/posSession.test.ts          7 ---                  "
apps/web/src/test-integration/pricing.test.ts             1 -                    "
apps/web/src/test-integration/tenantInvariants.test.ts    6 --                   "
apps/web/src/test-integration/tenantIsolation.test.ts     1 -                    "
apps/web/src/test-integration/uom.test.ts                 1 -                    "
apps/web/src/test-integration/wholesaleCustomer.test.ts   6 --                   "
19 files changed, 80 insertions(+), 65 deletions(-)
```

Deleted: `apps/web/src/test-integration/globalTeardown.ts` (untracked, unreferenced, never ran).

Deliberately **not** staged, left dirty in the working tree: `apps/web/test.out`,
`apps/web/test-integration.out` (tracked log artifacts, unrelated to this fix). `SCREENS/` was not
touched. No history was rewritten. No untracked prototype files were cleaned.

---

## 7. Remaining limitations

1. **File parallelism is still off.** `fileParallelism: false`, `isolate: false`, `maxWorkers: 1`
   remain in the config. `DELETE` removes the lock-ordering deadlock, but the suites still share
   one database and global fixtures, so concurrent workers would still race on fixture state.
   Re-enabling parallelism needs per-worker schemas or databases — a larger change, and at 110 s
   the current runtime does not justify it.
2. **The underlying fsync cost is environmental.** It is Docker-for-Windows volume I/O, not
   Postgres or Prisma. The same `TRUNCATE` on native Linux would be milliseconds. Anything added
   to the suite that issues `TRUNCATE`, `VACUUM FULL` or `CREATE/DROP TABLE` per test will
   reintroduce a seconds-scale penalty on this platform.
3. **`SET LOCAL session_replication_role = replica` requires a privileged role.** It works with
   this project's `amburax` superuser in the compose container. A CI database granting a
   restricted role would reject it and need `SUPERUSER`, or a revert to `TRUNCATE` with the cost
   that implies.
4. **`npm run typecheck` still fails while `next dev` is running**, on generated
   `.next/dev/types/validator.ts (TS1128)`. Unrelated to this fix and out of scope — generated
   output was not modified. Run static checks with the dev server stopped.
