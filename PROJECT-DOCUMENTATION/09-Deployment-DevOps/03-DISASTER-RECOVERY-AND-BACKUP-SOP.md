# Disaster Recovery and Backup SOP

| Document ID | AMB-OPS-003 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | SRE & Cloud Infrastructure Team |

---

## 1. Objectives (RTO & RPO)

- **Recovery Point Objective (RPO)**: $< 5 \text{ minutes}$. Continuous Write-Ahead Logging (WAL) archiving ensures maximum potential data loss is under 5 minutes.
- **Recovery Time Objective (RTO)**: $< 30 \text{ minutes}$. Full restoration of primary database and web application services.

---

## 2. Backup Protocol and Automation

### 2.1 Daily Automated Snapshots
A cron job executes an automated pg_dump snapshot every night at 02:00 IST:
```bash
#!/bin/bash
BACKUP_DIR="/var/backups/gpos"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="$BACKUP_DIR/gpos_backup_$TIMESTAMP.sql.gz"

pg_dump -U postgres -h localhost gpos_prod | gzip > "$FILENAME"

# Encrypt backup with GPG
gpg --encrypt --recipient backup-key@amburax.com "$FILENAME"

# Ship to off-site S3 cold storage
aws s3 cp "$FILENAME.gpg" s3://amburax-cold-backups/daily/
```

---

## 3. Disaster Recovery Restoration Runbook

In the event of hardware failure or catastrophic database corruption:

1. Provision a clean PostgreSQL 16 instance.
2. Download the latest verified snapshot from AWS S3.
3. Decrypt and restore the database schema and data:
   ```bash
   gpg --decrypt gpos_backup_20261019_020000.sql.gz.gpg | gunzip | psql -U postgres -d gpos_prod
   ```
4. Run `npx prisma migrate status` to confirm schema integrity.
5. Point the Next.js web instances to the restored database and launch services.
