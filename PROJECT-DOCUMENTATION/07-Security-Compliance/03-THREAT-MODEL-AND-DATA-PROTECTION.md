# Threat Model & Data Protection Plan

| Document ID | AMB-SEC-003 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Cybersecurity Operations Team |

---

## 1. STRIDE Threat Model Matrix

| Threat Category | Potential Vulnerability | System Countermeasure & Mitigation |
| :--- | :--- | :--- |
| **Spoofing** | Forged cashier identity | Signed encrypted iron-session cookies; re-authentication for sensitive actions. |
| **Tampering** | Modifying bill prices in client browser | Zero financial authority on client; all prices recomputed on server. |
| **Repudiation** | Customer disputes Udhar charge | Mandatory SMS OTP verification before credit; immutable ledger records. |
| **Information Disclosure** | Cross-tenant data leakage | Multi-tenant composite keys; mandatory WHERE clauses in all Prisma queries. |
| **Denial of Service** | Scanner flood / checkout spam | Rate limiting on API routes; PostgreSQL advisory locks serialize checkouts. |
| **Elevation of Privilege** | Cashier bypassing discount limit | PIN authorization required for discounts > 10%; verification handled server-side. |

---

## 2. Data Protection & Cryptographic Standards

1. **Data in Transit**: Enforce TLS 1.3 for all HTTP connections.
2. **Data at Rest**: PostgreSQL volumes encrypted using AES-256 block storage.
3. **Secret Management**:
   - Database credentials and session keys stored in `.env.local` / environment variables.
   - Secrets are excluded from version control repositories (`.gitignore`).
4. **PII Masking**: Customer phone numbers masked on thermal print receipts (`+91 84698 *****`).
