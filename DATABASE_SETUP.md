# AMBURAX POS — DATABASE SETUP

Verified working on 2026-09-12. Everything below was executed, not assumed.

---

## 1. What runs locally

| Fact | Value |
|---|---|
| Engine | PostgreSQL **16.15** (`postgres:16-alpine`) |
| Host | `localhost` |
| Port | **55432** (not 5432 — see below) |
| Development database | `amburax_identity` |
| Test database | `amburax_test` |
| Container name | `amburax-postgres` |
| Volume | `amburax_pgdata` |

**Why port 55432.** Ports 5432 and 5433 were already occupied on the machine this was set
up on by pre-existing PostgreSQL installations. This setup must never collide with or
overwrite one of those, so it deliberately binds a high port. Override with `POSTGRES_PORT`
if 55432 is taken too.

This is a **development and test** database. It is not a deployment artifact and
`docker-compose.yml` must not become one.

---

## 2. Environment variables (names only)

Never commit values for any of these. `.env` is gitignored at both levels; `.env.example`
is the committed template and contains placeholders only.

**Repository root `.env`** — consumed by `docker-compose.yml`:

| Name | Purpose |
|---|---|
| `POSTGRES_USER` | Database role created on first start |
| `POSTGRES_PASSWORD` | **Required. No default.** Compose aborts with a readable message if unset, so a password is never baked into a committed file |
| `POSTGRES_DB` | Database created on first start |
| `POSTGRES_PORT` | Host port to publish (default 55432) |

**`apps/web/.env`** — consumed by Prisma and Next.js:

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Full connection string for the app and for Prisma migrations |

The remaining application variables are documented in `apps/web/.env.example`.

---

## 3. Starting and stopping

First time:

```bash
cd D:\G-POS
cp .env.example .env          # then choose your own local password
docker compose up -d
```

Everyday use, from `apps/web`:

```bash
npm run db:up      # start
npm run db:down    # stop (data preserved)
npm run db:reset   # DESTROY the volume and start clean
```

Check it is ready:

```bash
docker compose ps                      # STATUS should read "Up (healthy)"
docker logs amburax-postgres --tail 20
```

The container has a healthcheck because `migrate deploy` can otherwise race a cold start —
`pg_isready` reports true slightly before the database accepts real queries.

---

## 4. Migration workflow

**Versioned migrations are the only permitted mechanism.** Every schema change is a file
under `apps/web/prisma/migrations/` and is committed as source.

Change the schema:

```bash
cd apps/web
# 1. edit prisma/schema.prisma
npm run prisma:migrate -- --name describe_your_change   # prisma migrate dev
# 2. commit BOTH the schema and the generated migration directory
```

Apply existing migrations without generating anything (CI, another developer, production):

```bash
npm run prisma:deploy    # prisma migrate deploy
npm run prisma:status    # prisma migrate status
```

Current state: **1 migration**, `20260911183622_init_identity_onboarding`, 355 lines of SQL
covering 12 tables, 8 enums, 28 constraints and 39 indexes.

### `prisma db push` is FORBIDDEN

Never use `prisma db push` as the schema mechanism, in any environment.

It mutates a database to match the schema **without recording a migration**. That leaves no
history, no rollback, no reviewable SQL, and no way for another machine or environment to
reproduce the same state. A database changed by `db push` and one changed by migrations
diverge silently, and the divergence is only discovered when a later migration fails to
apply. This project shipped nine screens with no migrations at all (audit finding P1-1);
that is exactly the hole this rule closes.

The only acceptable use is throwaway experimentation on a database you are about to delete.

---

## 5. Fresh database workflow

To prove a migration reproduces the schema from nothing:

```bash
docker exec amburax-postgres psql -U <user> -d postgres -c "CREATE DATABASE amburax_fresh;"
cd apps/web
DATABASE_URL="postgresql://<user>:<password>@localhost:55432/amburax_fresh?schema=public" \
  npx prisma migrate deploy
```

Verify it matches the intended schema exactly:

```bash
DATABASE_URL="...amburax_fresh..." npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel   prisma/schema.prisma \
  --exit-code
```

Exit code 0 and "No difference detected" is the pass condition. This was run on
2026-09-12: 134 columns, 28 constraints and 39 indexes came out identical to the
development database, with no manual DDL at any point.

---

## 6. Test database workflow

Integration tests run against `amburax_test`, never against `amburax_identity` — they
truncate every table between cases and would otherwise wipe your development data. The
guard is in `vitest.integration.config.ts`, which rewrites the database name in the URL.

Create and migrate it once:

```bash
docker exec amburax-postgres psql -U <user> -d postgres -c "CREATE DATABASE amburax_test;"
cd apps/web
DATABASE_URL="postgresql://<user>:<password>@localhost:55432/amburax_test?schema=public" \
  npx prisma migrate deploy
```

Run the suites:

```bash
npm run test              # unit — mocked Prisma, no database needed, fast
npm run test:integration  # real PostgreSQL, requires the container
```

The two are deliberately separate configs. `vitest.config.ts` injects a placeholder
`DATABASE_URL` so unit tests can import server modules offline; that placeholder is exactly
what must not be in scope for integration tests.

---

## 7. Seed workflow

```bash
cd apps/web
npm run db:seed
```

The seed is **idempotent** — every write is an `upsert` keyed on a natural unique column,
so running it twice produces identical row counts (verified). It creates one demo tenant,
one store, and two users.

Seed credentials are deliberately fake: `@demo.amburax.test` addresses on a reserved TLD
with an obvious placeholder password. **Never put a real credential in seed data**, and
never point the seed at a production database.

---

## 8. Reset procedures

| Goal | Command |
|---|---|
| Wipe data, keep the container | drop and recreate `amburax_identity` via `psql`, then `npm run prisma:deploy` |
| Wipe everything including the volume | `npm run db:reset` |
| Reset only the test database | drop/create `amburax_test`, then `migrate deploy` against it |

`npm run db:reset` runs `docker compose down -v`. The `-v` destroys the `amburax_pgdata`
volume and every byte in it, with no confirmation prompt.

---

## 9. Backup warning and documented procedure

**There is no automated scheduled backup of this database. None. Not a cloud snapshot, not a managed service, not a schedule.**

`amburax_pgdata` is a local Docker volume on one machine. `docker compose down -v`,
`docker volume rm`, a Docker Desktop factory reset, or a disk failure destroys it
permanently and instantly.

That is acceptable today because this database holds only development and test data that
`npm run db:seed` can recreate. It stops being acceptable the moment anything real lands
in it. Before that point, an operator must follow the documented backup and restore
verification procedure below — an untested backup is not a backup (see principles in
`AMBURAX_POS_FINAL_ALL_MD_v8 (1)/DISASTER_RECOVERY.md`).

---

### 9.1 Operator Backup & Restore Verification Procedure (Windows / PowerShell)

All commands below are designed for Windows PowerShell and interact with container `amburax-postgres`
without hard-coding environment secrets. The database role is `$env:POSTGRES_USER` (defaults to `amburax`).
A helper script is provided at `scripts/backup-db.ps1`.

#### Step 1: Create a Timestamped Custom-Format Backup
Creates a `pg_dump -Fc` archive inside the container, copies it to the host `backups\` directory,
and cleans up the container's temporary dump file:

```powershell
# NOT EXECUTED - Operator backup creation
.\scripts\backup-db.ps1 -SourceDatabase amburax_identity -BackupDir .\backups
```

*Manual equivalent (NOT EXECUTED):*
```powershell
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
$dbUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'amburax' }
docker exec amburax-postgres pg_dump -U $dbUser -d amburax_identity -Fc -f "/tmp/amburax_identity_$timestamp.dump"
if (-not (Test-Path .\backups)) { New-Item -ItemType Directory -Path .\backups | Out-Null }
docker cp "amburax-postgres:/tmp/amburax_identity_$timestamp.dump" ".\backups\amburax_identity_$timestamp.dump"
docker exec amburax-postgres rm -f "/tmp/amburax_identity_$timestamp.dump"
```

#### Step 2: Verify Archive Readability (Table of Contents Inspection)
Copies the host backup file back into the container and executes `pg_restore -l` to verify
the archive header and Table of Contents are uncorrupted:

```powershell
# NOT EXECUTED - Archive readability verification
.\scripts\backup-db.ps1 -VerifyListing -BackupFile .\backups\amburax_identity_<timestamp>.dump
```

*Manual equivalent (NOT EXECUTED):*
```powershell
docker cp ".\backups\amburax_identity_<timestamp>.dump" amburax-postgres:/tmp/verify_listing.dump
docker exec amburax-postgres pg_restore -l /tmp/verify_listing.dump
docker exec amburax-postgres rm -f /tmp/verify_listing.dump
```

> **CRITICAL OPERATIONAL NOTICE:** Listing an archive table of contents (`pg_restore -l`) proves
> that the archive file is readable. It does **NOT** prove that tables, constraints, foreign keys,
> and data can be successfully restored into PostgreSQL.

#### Step 3: Test Restoration into a Disposable Database (Safeguarded)
To prove recoverability without risking data loss, restorations must be tested **only** against
a separate, explicitly named disposable database (e.g. `amburax_restore_verification`).
The script and manual procedure contain hard safeguards:
- Refuses any target that matches the source database, `$env:POSTGRES_DB`, or protected databases (`postgres`, `template0`, `template1`, `amburax_identity`, `amburax_test`).
- Refuses already-existing target databases rather than automatically dropping them.
- Executes `CREATE DATABASE` separately (PostgreSQL does not permit `CREATE DATABASE` inside multi-statement query blocks).
- Runs `pg_restore` with `--exit-on-error` to fail fast on any SQL or restoration error.
- Validates that `pg_restore` exited with code 0 and required core application tables (`tenants`, `product_variants`, `users`, `stock_movements`) are present.
- Explicitly limits claims: verifies restore command exit code 0 and required table presence only; does not claim row-level or full data-integrity validation.

```powershell
# NOT EXECUTED - Real restoration test against a new disposable database
.\scripts\backup-db.ps1 -TestRestore -BackupFile .\backups\amburax_identity_<timestamp>.dump -TestDatabase amburax_restore_verification
```

*Manual equivalent (NOT EXECUTED):*
```powershell
$testDb = 'amburax_restore_verification'
$dbUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'amburax' }
$sourceDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { 'amburax_identity' }

# 1. Identifier validation
if ($testDb -notmatch '^[a-zA-Z0-9_]+$') { throw "Invalid database name '$testDb'." }

# 2. Protected database check
$protected = @('postgres', 'template0', 'template1', 'amburax_identity', 'amburax_test', $sourceDb)
if ($testDb -in $protected) {
    throw "Target database '$testDb' is protected or matches the source. Choose a distinct disposable database."
}

# 3. Refuse if database already exists (never auto-drop)
$exists = docker exec amburax-postgres psql -U $dbUser -d postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname = '$testDb';"
if ($exists.Trim() -eq '1') {
    throw "Database '$testDb' already exists. Choose a non-existent disposable name."
}

# 4. Create new disposable database
docker exec amburax-postgres psql -U $dbUser -d postgres -c "CREATE DATABASE `"$testDb`";"

# 5. Copy and restore (fail-fast on any SQL error)
docker cp ".\backups\amburax_identity_<timestamp>.dump" amburax-postgres:/tmp/restore_test.dump
docker exec amburax-postgres pg_restore -U $dbUser -d $testDb --exit-on-error --no-owner --no-privileges /tmp/restore_test.dump
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with exit code $LASTEXITCODE." }
docker exec amburax-postgres rm -f /tmp/restore_test.dump

# 6. Verify required table presence (verifies table existence only, not row-level data)
docker exec amburax-postgres psql -U $dbUser -d $testDb -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('tenants', 'product_variants', 'users', 'stock_movements');"

# 7. Cleanup disposable target database when operator confirms verification
docker exec amburax-postgres psql -U $dbUser -d postgres -c "DROP DATABASE `"$testDb`";"
```

---

## 10. Troubleshooting

**`POSTGRES_PASSWORD is not set`** — compose is doing its job. Copy `.env.example` to
`.env` at the repository root and set a local password.

**`P1000: Authentication failed`** — `apps/web/.env`'s `DATABASE_URL` disagrees with the
root `.env`. The user, password, port and database name must match. If you changed
`POSTGRES_PASSWORD` after the first start, the volume still holds the *old* role: either use
the old password or `npm run db:reset` to reinitialise.

**`P1001: Can't reach database server`** — the container is not running or the port is
wrong. `docker compose ps`, confirm `Up (healthy)`, confirm `POSTGRES_PORT`.

**Port already allocated** — something else holds the port. Check with
`netstat -ano | findstr :55432`, then set a different `POSTGRES_PORT` and `docker compose up -d`
again. Do not stop the other service; it may be a PostgreSQL another project depends on.

**`migrate status` reports drift or a failed migration** — do not fix it by hand and do
not reach for `db push`. Resolve it with `prisma migrate resolve`, or on a development
database, reset and reapply.

**Integration tests hang** — they run single-worker by design and the concurrency cases
block on real row locks. If they hang past the 30 s timeout, the container is probably
unhealthy: `docker logs amburax-postgres`.

**Tests wiped my development data** — they should be pointed at `amburax_test`. Check the
`DATABASE_URL` in `apps/web/.env` still names `amburax_identity`; the rewrite in
`vitest.integration.config.ts` depends on that name.
