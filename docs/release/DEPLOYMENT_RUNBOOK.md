# AMBURAX G-POS — Staging & Production Deployment Runbook

| Metadata | Details |
| :--- | :--- |
| **System** | AMBURAX G-POS |
| **Runbook ID** | RBK-STG-001 |
| **Version** | 1.0.0 |
| **Date** | October 19, 2026 |
| **Target Runtime** | Node.js 24 LTS, PM2 Process Manager, PostgreSQL 16 |

---

## 1. Pre-Deployment Verification

Before triggering any staging or production deployment, verify on the deployment runner:

```bash
# 1. Verify Node.js and npm versions
node -v   # Expected: v24.x
npm -v    # Expected: 10.x or 11.x

# 2. Check clean repository status
git status --short

# 3. Verify clean dependencies installation
npm ci

# 4. Verify Prisma client generation
npm run prisma:generate -w @amburax/web

# 5. Run full test suite checks
npm test -w @amburax/web
npm run test:component -w @amburax/web
```

---

## 2. Environment Configuration Preparation

Create `/opt/amburax/gpos/.env` with staging-specific configurations (do not commit this file):

```env
# Runtime
NODE_ENV=production
PORT=3001
APP_BASE_URL=https://staging-pos.yourdomain.com

# PostgreSQL Connection
DATABASE_URL="postgresql://amburax_staging_user:SECURE_STAGING_PASSWORD@staging-db-host:5432/amburax_staging?schema=public"

# Auth & Session Security
SESSION_COOKIE_NAME="amburax_staging_session"
SESSION_TTL_HOURS=12
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15

# Security & OTP (Staging Sandbox Configuration)
DEV_OTP_ECHO=false
DEV_RESET_LINK_ECHO=false
DEV_INVITE_LINK_ECHO=false

# Outbox & ERPNext Worker
OUTBOX_TRANSPORT=erpnext
OUTBOX_POLL_INTERVAL_MS=3000
OUTBOX_BATCH_SIZE=25

# ERPNext Staging Site Credentials (Keyed by Site Slug)
ERP_SITE_STAGING_SITE_URL=https://erp-staging.yourdomain.com
ERP_SITE_STAGING_SITE_KEY=your_sandbox_api_key
ERP_SITE_STAGING_SITE_SECRET=your_sandbox_api_secret
```

---

## 3. Database Migration Deployment

Execute database schema migrations against the staging PostgreSQL database:

```bash
# Verify current migration status without modifying data
npm run prisma:status -w @amburax/web

# Apply pending migrations transactionally
npm run prisma:deploy -w @amburax/web

# (Optional) Seed standard demonstration catalog and test store
npm run db:seed:demo -w @amburax/web
```

---

## 4. Production Application Build

Compile the Next.js production bundle using Turbopack:

```bash
npm run build -w @amburax/web
```
*Expected Result*: Next.js compiles 131+ static and dynamic routes with 0 errors.

---

## 5. Process Execution & Supervision via PM2

Deploy and start services using the verified `ecosystem.config.cjs` configuration:

```bash
# Start or reload both Web App and Outbox Worker
pm2 start ecosystem.config.cjs --env production

# Check cluster status
pm2 status

# Monitor real-time logs
pm2 logs amburax-pos-web --lines 50
pm2 logs amburax-pos-outbox --lines 50

# Save process list for system reboot persistence
pm2 save
```

---

## 6. Reverse Proxy & SSL Configuration (Nginx Example)

```nginx
server {
    listen 80;
    server_name staging-pos.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name staging-pos.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/staging-pos.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/staging-pos.yourdomain.com/privkey.pem;

    # Security Headers
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }
}
```

---

## 7. Post-Deployment Verification (Smoke Test)

```bash
# 1. HTTP Status Check
curl -I https://staging-pos.yourdomain.com/auth/login
# Expected: HTTP/2 200 OK

# 2. Check Outbox Worker Heartbeat
pm2 describe amburax-pos-outbox
# Expected: status 'online', memory < 150MB, restart count 0
```
