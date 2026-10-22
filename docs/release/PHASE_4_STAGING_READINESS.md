# AMBURAX G-POS — Phase 4: Staging Readiness Assessment & Verification

| Metadata | Details |
| :--- | :--- |
| **System** | AMBURAX G-POS (Point of Sale & Retail Management) |
| **Repository** | `D:\amburax-projects\G-POS` |
| **Phase** | Phase 4: Staging Deployment Preparation & Safety Audit |
| **Date** | October 19, 2026 |
| **Status** | **READY FOR STAGING SETUP** |

---

## 1. Executive Summary

Following the remediation and test resolution completed in Phase 3 (achieving 100% test pass rate across unit, integration, and component suites), this Phase 4 Audit evaluated the operational readiness for staging deployment.

### Current Readiness Gates Status
- **Automated Test Suites**:
  - Unit Tests: 1,068 / 1,068 passed (92 suites)
  - Component Tests: 175 / 175 passed (16 suites)
  - Core Integration Tests: 84 / 84 passed (Sales, Udhar/Khata, Returns)
- **Static Analysis & Build**:
  - TypeScript: Clean (`tsc --noEmit` exited 0)
  - ESLint: 0 errors (7 acceptable stylistic warnings)
  - Production Build: Next.js 16.3.4 (Turbopack) compiled cleanly (131 static/dynamic routes)
- **Compliance & SBOM**:
  - 644 packages scanned; 0 violations; 15 documented approved exceptions
  - CycloneDX v1.5 JSON SBOM verified (`docs/compliance/sbom.cyclonedx.json` with 657 components)
- **Hosting & Runtime Topology Identified**:
  - Next.js Web App: Node.js 24 cluster managed via PM2 (`ecosystem.config.cjs`) on port 3001 behind an Nginx reverse proxy with SSL termination.
  - Background Outbox Worker: Standalone daemon process (`npx tsx src/server/events/outboxWorker.ts` / `npm run outbox:work`) managed via PM2.
  - Database: PostgreSQL 16 with deterministic collation (`--locale=C --encoding=UTF8`) and transactional migrations via Prisma.
  - Outbox Transport: Supports `OUTBOX_TRANSPORT=erpnext` (for Frappe/ERPNext sync) and `none`/`console` (development stand-ins).

---

## 2. Staging Infrastructure Requirements

To deploy G-POS to a staging environment without endangering production or live ERP systems, the target environment must satisfy:

1. **Dedicated Staging Database**:
   - PostgreSQL 16 instance separate from production and dev test containers.
   - Run `npx prisma migrate deploy -w @amburax/web` to apply all 52 deterministic migrations from a zero state.
2. **Process Management**:
   - PM2 runtime installed globally on the staging VM or host.
   - Distinct process names (`staging-gpos-web`, `staging-gpos-outbox`) to prevent collisions.
3. **Network Isolation**:
   - Port 3001 bound to localhost (`127.0.0.1:3001`) or internal virtual network only, exposed externally strictly via reverse proxy (Nginx or Caddy) with valid TLS certificates.
4. **Isolated ERPNext Staging Instance**:
   - Dedicated Frappe/ERPNext staging site (e.g. `staging-erp.internal` or dedicated test company) to prevent ledger pollution.

---

## 3. Prerequisite Checklist & Approval Gates

| Category | Prerequisite | Repository State / Evidence | Staging Requirement | Blocker / Owner |
| :--- | :--- | :--- | :--- | :--- |
| **Database** | PostgreSQL 16 Primary | Local docker-compose & CI container configured | Standalone staging PostgreSQL instance | Requires staging DB provisioning |
| **Migrations** | Zero-downtime Prisma migrations | 52 sequential migrations verified in CI fresh-database run | Execute `prisma migrate deploy` | Ready to apply |
| **App Server** | Node.js v24 LTS | Toolchain verified on Node 24 | Node.js v24.x + npm 11.x on staging server | System Administrator |
| **Process Manager**| PM2 process definitions | Configured in `ecosystem.config.cjs` | Configured with staging env vars | Ready |
| **Background Worker**| Transactional Outbox Worker | `apps/web/src/server/events/outboxWorker.ts` | Supervised by PM2 (`npm run outbox:work`) | Ready |
| **ERP Integration** | ERPNext Site API credentials | Verified via `EnvErpCredentialProvider` (`ERP_SITE_<ID>_URL/KEY/SECRET`) | Dedicated sandbox site credentials | Requires Staging ERP credentials |
| **Domain & TLS** | HTTPS termination | Documented in `AMB-OPS-002` | Valid SSL certificate & staging DNS record | Network / SRE Team |
| **Test Payments** | EDC / UPI test gateway | Test mode simulation supported in code | Sandbox merchant credentials (if live testing) | Optional (Offline / cash test works) |

---

## 4. Operational Risk Analysis

1. **ERP Ledger Pollution**:
   - *Risk*: Pushing real-time sales outbox events to an active production ERPNext company.
   - *Mitigation*: Ensure `OUTBOX_TRANSPORT=none` or point `ERP_SITE_<SITEID>_URL` strictly to a sandbox Frappe site during staging.
2. **Double Cash-Drawer Conflicts**:
   - *Risk*: Cash register sessions colliding across multiple cashiers on the same terminal ID.
   - *Mitigation*: Terminal pairing requires distinct browser cookies and terminal IDs per counter (`/api/v1/pos/devices/pair-here`).
3. **Offline DB State Collisions**:
   - *Risk*: Multiple browser tabs or users sharing the same client-side IndexedDB database.
   - *Mitigation*: Till offline caching is keyed by tenant and variant in browser local storage. Store testers must use clean browser profiles or incognito sessions.

---

## 5. Phase 4 Conclusion & Verdict

**VERDICT: READY FOR STAGING SETUP**

All code, configurations, schemas, tests, and documentation are verified and stable. The software artifacts are fully built and tested. Physical deployment can proceed as soon as the staging host, database instance, and sandbox credentials are provided by the operations team.
