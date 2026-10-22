# AMBURAX — ERPNext Integration Boundary Specification

| Document ID | AMB-ARCH-ERP-001 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Enterprise Architecture & Security Engineering |

---

## 1. Architectural & Process Separation

AMBURAX G-POS integrates with ERPNext as an external system through a hardened server-side adapter:

```text
+--------------------------------------------------------------------+
|               AMBURAX G-POS PROPRIETARY DOMAIN                     |
|                                                                    |
|  [Counter Terminal]  -->  [saleService.ts]  -->  [PostgreSQL 16]   |
|                                |                                   |
|                     (Transactional Outbox)                         |
|                                v                                   |
|                       [ErpOutboxPublisher]                         |
+--------------------------------+-----------------------------------+
                                 | (HTTP JSON / Server-to-Server Only)
                                 v
+--------------------------------------------------------------------+
|                 AMBURAX ERP INTEGRATION BOUNDARY                   |
|                                                                    |
|             [ErpClient.ts] <--> [HttpErpTransport.ts]              |
|        - Error Normalization & Timeout Management                  |
|        - Sanitize Logs (Zero Secret / Token Leakage)               |
|        - Per-Tenant Credential Resolution                          |
+--------------------------------+-----------------------------------+
                                 | (Encrypted Network REST API / Token)
                                 v
+--------------------------------------------------------------------+
|                  EXTERNAL ERPNEXT DEPLOYMENT                       |
|                                                                    |
|         [ERPNext REST API]  -->  [MariaDB Database]                |
+--------------------------------------------------------------------+
```

---

## 2. Mandatory Architectural Invariants

### Invariant 1: Server-Side Network Boundary Only (ADR-002)
- Zero ERPNext knowledge or credentials exist in frontend React components or client bundles.
- All requests flow from server-side Route Handlers or background outbox workers.

### Invariant 2: Secret & Credential Vaulting
- Credentials (`apiKey` and `apiSecret`) are retrieved exclusively via `EnvErpCredentialProvider` or secure key vault per tenant.
- Credentials never enter persisted database rows or telemetry logs (`sanitizeText` applied).

### Invariant 3: Zero Cross-Database Access
- AMBURAX G-POS connects exclusively to **PostgreSQL 16**.
- G-POS services **never** connect directly to ERPNext's MariaDB instance via SQL drivers. All interaction is mediated by Frappe REST APIs.

### Invariant 4: Transactional Decoupling & Outbox Reliability
- Counter sales commit immediately to PostgreSQL.
- Synchronization to ERPNext occurs asynchronously through `outbox_events` with exponential backoff retries.
- Failures on ERPNext never block customer checkouts at physical store counters.

### Invariant 5: Idempotency & Conflict Prevention
- Every call to ERPNext carries a derived `X-Idempotency-Key` and `X-Correlation-Id`.
- Retrying an outbox event replays the identical key, preventing duplicate Sales Invoices in ERPNext.
