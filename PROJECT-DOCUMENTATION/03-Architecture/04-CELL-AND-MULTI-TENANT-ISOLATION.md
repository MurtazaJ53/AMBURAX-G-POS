# Cell & Multi-Tenant Isolation Architecture

| Document ID | AMB-ARCH-004 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Enterprise Architecture Team |

---

## 1. Multi-Tenant Partitioning Model

AMBURAX G-POS employs a **Shared Process / Shared Database with Row-Level Discrimination** architecture, governed by composite database indexes and mandatory tenant context resolvers.

```text
+---------------------------------------------------------------+
|                    HTTP Request Headers                       |
|           Cookie: session_token (Signed with Secret)          |
+---------------------------------------------------------------+
                               |
                               v
+---------------------------------------------------------------+
|                 Session & Capability Guard                     |
|           Resolves: tenantId, storeId, userId, role           |
+---------------------------------------------------------------+
                               |
                               v
+---------------------------------------------------------------+
|              Prisma Query & Tenant Enforcer                   |
|        WHERE "tenantId" = session.tenantId                    |
|        AND "companyId" = session.companyId                    |
+---------------------------------------------------------------+
                               |
                               v
+---------------------------------------------------------------+
|                   PostgreSQL 16 Engine                        |
|       Composite Unique Constraints: [tenantId, id]            |
|       Row-Level Security & Advisory Lock Boundaries           |
+---------------------------------------------------------------+
```

---

## 2. Company vs. Store Scoping Rules

In retail organizations, a business may operate multiple retail branches (Stores) under one legal entity (Company), or multiple distinct Companies under one Tenant.

| Entity | Scope | Isolation Boundary |
| :--- | :--- | :--- |
| **Product Master** | Tenant Scoped | Available across all stores and companies within the tenant. |
| **Inventory Stock** | Store Scoped | Physical inventory is strictly tracked per store location. |
| **Khata Credit Ledger** | Company Scoped | Credit liability and repayments follow the legal Company entity. |
| **Sales Invoices** | Store Scoped | Bill sequences and cash registers are isolated per store location. |
| **Promotions** | Store / Tenant Scoped | Configurable to apply across all stores or specific branches. |

---

## 3. Data Leak Prevention Safeguards

1. **Composite Primary & Unique Keys**:
   - Every major table utilizes composite unique keys including `tenantId`:
     `@@unique([tenantId, idempotencyKey])`
     `@@unique([tenantId, companyId, customerId])`
2. **Advisory Locking with Tenant Prefixes**:
   - PostgreSQL advisory locks are hashed with tenant UUID prefixes to prevent lock contention between distinct tenants.
3. **Session Re-verification**:
   - The user session is resolved on every server API call directly from the cryptographically verified iron-session cookie; client-supplied tenant query parameters are strictly forbidden.
