# AMBURAX G-POS — Open Source & Commercial License Policy

| Document ID | AMB-POL-LIC-001 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved Corporate Policy |
| **Date** | 2026-10-19 | Authors | Legal Governance & IP Architecture Board |

---

## 1. Purpose and Scope

This License Policy governs all third-party software libraries, frameworks, open-source packages, and external application integrations used across **AMBURAX G-POS**. Its primary goal is to **protect the proprietary commercial status of AMBURAX G-POS** while establishing verifiable, repeatable compliance with all applicable open-source licenses.

---

## 2. License Classification & Ingestion Matrix

### 2.1 Category A: Pre-Approved Permissive Licenses (GREEN)
Dependencies carrying these licenses may be added to any workspace without individual legal review:
- **MIT License**
- **Apache License 2.0**
- **ISC License**
- **BSD 2-Clause / BSD 3-Clause / 0BSD**
- **Python Software Foundation License (PSF / Python-2.0)**
- **Creative Commons Zero (CC0-1.0)**
- **The Unlicense**

### 2.2 Category B: Review-Required / Weak Copyleft Licenses (YELLOW)
Dependencies carrying these licenses require an explicit entry in the **Approved Exceptions Register** with documented technical justification:
- **LGPL v2.1 / v3.0** (Must be dynamically linked; no static compilation into proprietary binaries).
- **MPL 2.0** (Mozilla Public License — file-level copyleft; modifications must be shared if distributed, but does not taint proprietary files).
- **EPL 1.0 / 2.0** (Eclipse Public License).
- **Dual-Licensed Packages** (Where one branch is permissive).

### 2.3 Category C: Strictly Prohibited Copyleft Licenses (RED)
The following licenses are **STRICTLY PROHIBITED** from inclusion in any production package or binary bundled into AMBURAX G-POS:
- **AGPL-1.0 / AGPL-3.0** (Affero General Public License — network copyleft trigger).
- **GPL-1.0 / GPL-2.0 / GPL-3.0** (General Public License — strong copyleft).
- **SSPL** (Server Side Public License).
- **UNKNOWN / Missing License** (Any package without an explicit SPDX license identifier).

---

## 3. Automated Enforcement & CI Gate

1. **Continuous Fail-Closed Gate**:
   - Every commit and pull request executes `npm run license:audit` (or Vitest suite `src/test/licenseComplianceGate.test.ts`).
   - If a newly introduced dependency carries a Category C license or is not pre-approved, CI exits with code `1` and blocks merging.
2. **Exception Approval Procedure**:
   - To request an exception for a Category B package:
     1. Submit an architectural note detailing: package role, linking mechanism (static vs dynamic), and distribution scope.
     2. Obtain sign-off from the Principal Architect and Legal Counsel.
     3. Add the package to `scripts/licenseAudit.ts` under `POLICY.EXCEPTIONS`.

---

## 4. ERPNext & Frappe Specific Policies

1. **Clean Repository Separation**:
   - ERPNext (GPLv3) and Frappe (MIT) source code must **never be copied, vendored, or committed** into this repository (`G-POS`).
   - Custom Frappe DocTypes or Python hooks must reside in a dedicated standalone repository (`amburax_erp`).
2. **Network Integration Boundary**:
   - All communication with ERPNext must occur strictly over HTTP/REST network boundaries (`ErpClient` and `HttpErpTransport`).
3. **Trademark Policy**:
   - The terms "ERPNext" and "Frappe" are registered trademarks of Frappe Technologies Pvt. Ltd.
   - AMBURAX G-POS must use nominative fair use phrasing: *"AMBURAX G-POS — with ERPNext integration"*, and must never represent itself as an official Frappe product.
