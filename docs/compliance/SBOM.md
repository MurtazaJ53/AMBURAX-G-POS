# AMBURAX G-POS — Software Bill of Materials (SBOM)

| Specification | Standard | Version |
| :--- | :--- | :--- |
| **Standard** | CycloneDX 1.5 JSON & SPDX 2.3 Compatible | 1.1.0 |
| **Component** | AMBURAX G-POS Core (`@amburax/web`) | Production & Development |
| **Generation Date** | 2026-10-19 | Automated Audit via `scripts/licenseAudit.ts` |
| **Machine-Readable Artifact** | [`docs/compliance/sbom.cyclonedx.json`](file:///d:/amburax-projects/G-POS/docs/compliance/sbom.cyclonedx.json) | CycloneDX v1.5 Schema Valid |
| **Authoritative Hash** | SHA-512 / SHA-1 Verified against `package-lock.json` |

---

## 1. Executive Summary & Inventory Tally

| Category | Count | Status | Notes |
| :--- | :---: | :---: | :--- |
| **Total Tracked Packages** | **644** | Verified | Reconciled across local `node_modules/` and `package-lock.json` (includes optional cross-platform binaries) |
| **Permissive Licenses** | **629** | Permitted | MIT (540), Apache-2.0 (59), ISC (25), BSD (12), CC0/0BSD/Python/BlueOak (4) |
| **Weak Copyleft / Approved Exceptions** | **15** | Approved with Justification | Precompiled Sharp image optimization runtime binaries (Win32, Darwin, Linux, Wasm) and `axe-core` |
| **Strong Copyleft (GPL / AGPL / SSPL)** | **0** | Clean | Zero GPL/AGPL dependencies linked into proprietary source |
| **Unknown / Ambiguous Licenses** | **0** | Clean | Zero missing licenses |

---

## 2. Direct Production Dependencies Inventory

| Package Name | Version | License | Role / Purpose | Copyleft Obligation |
| :--- | :--- | :--- | :--- | :--- |
| `@prisma/client` | 5.20.0 | Apache-2.0 | PostgreSQL ORM runtime | None (Permissive) |
| `@radix-ui/react-dialog` | 1.1.23 | MIT | Headless accessible modal primitives | None (Permissive) |
| `@radix-ui/react-dropdown-menu` | 2.1.24 | MIT | Headless dropdown menus | None (Permissive) |
| `@radix-ui/react-slot` | 1.3.3 | MIT | Component composition | None (Permissive) |
| `@radix-ui/react-tabs` | 1.1.21 | MIT | Tab panels | None (Permissive) |
| `bcryptjs` | 2.4.3 | MIT | Password & manager PIN hashing | None (Permissive) |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | Type-safe UI variant styling | None (Permissive) |
| `clsx` | 2.1.1 | MIT | Class string concatenation | None (Permissive) |
| `lucide-react` | 1.47.0 | ISC | POS UI vector icons | None (Permissive) |
| `next` | 16.3.4 | MIT | Full-stack React framework & Route Handlers | None (Permissive) |
| `react` | 19.0.0 | MIT | UI rendering runtime | None (Permissive) |
| `react-dom` | 19.0.0 | MIT | DOM rendering runtime | None (Permissive) |
| `tailwind-merge` | 3.7.0 | MIT | Utility class merging | None (Permissive) |
| `xlsx` | 0.18.5 | Apache-2.0 | Spreadsheet report exports (CSV/XLSX) | None (Permissive) |
| `zod` | 3.23.8 | MIT | Request and domain schema validation | None (Permissive) |

---

## 3. Approved Exceptions & Weak-Copyleft Package Register

| Package Name | Version | License Expression | Scope | Justification & Legal Position |
| :--- | :--- | :--- | :--- | :--- |
| `@img/sharp-win32-x64` | 0.35.4 | `Apache-2.0 AND LGPL-3.0-or-later` | Optional Runtime Binary | Precompiled native runtime binary for Next.js image optimization. Dynamically linked; not statically compiled into proprietary source. |
| `@img/sharp-wasm32` | 0.35.4 | `Apache-2.0 AND LGPL-3.0-or-later AND MIT` | Optional Runtime Binary | Wasm binary for image optimization. Dynamically loaded; not compiled into proprietary source. |
| `axe-core` | 4.13.0 | `MPL-2.0` | Development Only | Transitive build-time dependency of `eslint-plugin-jsx-a11y`. Used strictly for accessibility linting; never shipped or bundled into production JavaScript. |

---

## 4. Separately Managed Components (ERPNext / Frappe)

| Component | License | Architectural Placement | Distribution Status |
| :--- | :--- | :--- | :--- |
| **Frappe Framework** | MIT | Separate process / MariaDB | Separately deployed; not bundled into G-POS installer. |
| **ERPNext Core** | GPLv3 | Separate process / MariaDB | Separately deployed; network API boundary (`HttpErpTransport`). |
| **Future `amburax_erp` App** | GPLv3-compatible | Separate Git repository | Custom Frappe DocTypes live in a standalone Frappe app, never in `apps/web/`. |
