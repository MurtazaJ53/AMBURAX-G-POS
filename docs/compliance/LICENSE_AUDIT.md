# AMBURAX G-POS — License Audit and Verification Report

| Document ID | AMB-REP-LIC-001 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Audited & Verified |
| **Audit Date** | 2026-10-19 | Auditor | Automated Compliance Engine & Engineering Team |

---

## 1. Audit Scope & Methodology

The license compliance audit inspected:
1. Root repository `package.json`, `package-lock.json`, and root `node_modules/`.
2. Workspace `apps/web/package.json` and `apps/web/node_modules/`.
3. Server domain services under `apps/web/src/server/erp/`.
4. Git commit logs, Docker configuration (`docker-compose.yml`), and static assets.

**Auditing Tooling**:
- Primary: Custom deterministic AST & manifest auditor (`scripts/licenseAudit.ts`).
- Verification: Vitest automated compliance gate (`src/test/licenseComplianceGate.test.ts`).

---

## 2. Quantitative Scan Results

- **Total Unique Packages Audited**: **515**
- **Permitted Packages (Category A)**: **512** (99.4%)
- **Approved Exceptions (Category B)**: **3** (0.6%)
- **Prohibited Copyleft (Category C)**: **0** (0.0%)
- **Unknown / Unresolved Licenses**: **0** (0.0%)

### License Breakdown
- `MIT`: 436 packages
- `Apache-2.0`: 43 packages
- `ISC`: 16 packages
- `BSD-2-Clause` / `BSD-3-Clause`: 12 packages
- `0BSD` / `CC0-1.0` / `Python-2.0` / `CC-BY-4.0`: 5 packages
- `Apache-2.0 AND LGPL-3.0-or-later`: 1 package (`@img/sharp-win32-x64`)
- `Apache-2.0 AND LGPL-3.0-or-later AND MIT`: 1 package (`@img/sharp-wasm32`)
- `MPL-2.0`: 1 package (`axe-core`)

---

## 3. Case-by-Case Exception Evaluation

### 3.1 `@img/sharp-win32-x64` & `@img/sharp-wasm32` (Version 0.35.4)
- **License**: Apache-2.0 AND LGPL-3.0-or-later
- **Role**: Native precompiled binaries for Sharp/Next.js image resizing.
- **Finding**: The LGPL component resides in dynamically loaded shared libraries. AMBURAX G-POS source code does not modify or statically compile Sharp into proprietary binaries.
- **Verdict**: **APPROVED EXCEPTION** for Cloud SaaS.

### 3.2 `axe-core` (Version 4.13.0)
- **License**: MPL-2.0
- **Role**: Transitive development dependency of `eslint-plugin-jsx-a11y`.
- **Finding**: Used strictly during `npm run lint` in development. It is excluded from the Next.js production build bundle (`.next/static/`).
- **Verdict**: **APPROVED EXCEPTION** (Zero production conveyance).

---

## 4. Final Compliance Verdict

**STATUS: PASS (COMPLIANT FOR CLOUD SAAS RELEASE)**  
There are **zero licensing blockers** preventing the commercial SaaS deployment of AMBURAX G-POS.
