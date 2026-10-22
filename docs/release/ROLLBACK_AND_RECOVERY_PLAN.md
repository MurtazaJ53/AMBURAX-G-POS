# AMBURAX G-POS — Rollback and Recovery Plan

| Metadata | Details |
| :--- | :--- |
| **System** | AMBURAX G-POS |
| **Document ID** | DRP-REC-001 |
| **Version** | 1.0.0 |
| **Date** | October 19, 2026 |
| **SRE Authority** | Site Reliability Engineering Team |

---

## 1. Rollback Objectives and Triggers

A rollback is executed when any of the following critical conditions arise during or immediately following deployment:
1. **Critical Service Failure**: Unhandled application crashes or error rates exceeding 1% on POS counter checkout routes (`/api/v1/sales`, `/api/v1/pos/scan`).
2. **Database Inconsistency**: Uncaught schema drift or migration failures locking transaction tables.
3. **Data Integrity Violation**: Idempotency breach, double-charge issues, or ledger mismatch in customer Khata balances.
4. **Outbox Worker Lockup**: Worker starvation or persistent dead-letter storm (>5% failure rate) on ERP synchronization.

---

## 2. Fast Rollback Procedure (Application Tier)

Because AMBURAX G-POS follows the backward-compatible *Expand and Contract* pattern for database schemas, code rollbacks can typically be executed without rolling back database migrations.

### Step 1: Rollback Previous Node.js Artifact
```bash
# In the staging / production repository root:
git checkout <PREVIOUS_STABLE_COMMIT_OR_TAG>

# Re-install verified dependencies
npm ci

# Re-generate Prisma Client
npm run prisma:generate -w @amburax/web

# Rebuild previous production bundle
npm run build -w @amburax/web
```

### Step 2: Reload PM2 Services with Zero Downtime
```bash
# Graceful reload of web cluster (reloads instances one by one)
pm2 reload amburax-pos-web

# Restart background outbox worker
pm2 restart amburax-pos-outbox

# Confirm health check
curl -f -I http://127.0.0.1:3001/auth/login
```

---

## 3. Database Recovery & Migration Rollback

### Backward-Compatibility Contract
- All migrations in `apps/web/prisma/migrations` are additive (new tables, new nullable columns, non-destructive constraints).
- Code is engineered to tolerate newly added columns even if application code is reverted to a previous commit.

### Catastrophic Migration Reversal (Hotfix Protocol)
If a destructive migration was applied by mistake:
1. Immediately place POS counters into Offline Mode: Cashiers can continue billing locally in browser IndexedDB without server connectivity.
2. Stop PM2 processes:
   ```bash
   pm2 stop all
   ```
3. Restore from the most recent pre-deployment snapshot:
   ```bash
   # Decrypt and restore PostgreSQL snapshot
   gunzip -c /var/backups/gpos/pre_deploy_backup.sql.gz | psql -U amburax -d amburax_staging
   ```
4. Verify migration state matches expected baseline:
   ```bash
   npm run prisma:status -w @amburax/web
   ```
5. Restart PM2 processes:
   ```bash
   pm2 start ecosystem.config.cjs --env production
   ```
6. Allow POS terminals to reconnect: Queued offline transactions in cashiers' browsers will automatically replay to the restored database using their unique idempotency keys.

---

## 4. Disaster Recovery & Snapshot Automation

### Daily Automated Backup Script (`scripts/backup-db.ps1`)
The repository contains an enterprise-grade automated backup script for Windows / PowerShell environments (`scripts/backup-db.ps1`) supporting:
- Automatic PostgreSQL container/service discovery
- Gzip compression with timestamped rotation
- Verification tests via `scripts/test-backup-db.ps1`
- 30-day snapshot retention policy

### Linux Production Equivalent
```bash
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR="/var/backups/gpos"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
SNAPSHOT="$BACKUP_DIR/gpos_snapshot_$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"
pg_dump -U amburax -h 127.0.0.1 -p 5432 amburax_staging | gzip > "$SNAPSHOT"

# Verify backup integrity
gunzip -t "$SNAPSHOT"
echo "Backup successfully created and verified: $SNAPSHOT"
```
