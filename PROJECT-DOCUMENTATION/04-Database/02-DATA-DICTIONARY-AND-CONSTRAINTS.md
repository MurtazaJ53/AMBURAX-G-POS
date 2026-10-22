# Data Dictionary & Database Constraints

| Document ID | AMB-DB-002 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Database Architecture Team |

---

## 1. Monetary Storage Standard: Minor Units (Paisa)

To eliminate IEEE-754 floating-point rounding errors and precision loss:
- **All financial fields are stored as 64-bit safe integers in Minor Units (Paisa)**:
  `₹1.00` = `100` minor units.
  `₹4,982.50` = `498250` minor units.
- Floating-point calculations (`FLOAT` / `DOUBLE PRECISION`) are strictly forbidden in financial tables.
- Display conversions occur only at the presentation boundary via formatted utility helpers.

---

## 2. Table-by-Table Data Dictionary

### 2.1 Customer Credit Accounts (`customer_credit_accounts`)

| Column Name | Data Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | VARCHAR(64) | NO | Primary Key | Account identifier (`cca_...`) |
| `tenantId` | VARCHAR(64) | NO | None | Multi-tenant tenant identifier |
| `companyId` | VARCHAR(64) | NO | None | Legal company owning the ledger |
| `customerId` | VARCHAR(64) | NO | None | Customer linked to this account |
| `currency` | VARCHAR(3) | NO | 'INR' | ISO currency snapshot |
| `creditMode` | ENUM | NO | 'LIMITED' | `BLOCKED`, `LIMITED`, `UNLIMITED` |
| `creditModeLimitMinor`| BIGINT | YES | 0 | Max credit exposure in paisa |
| `creditHold` | BOOLEAN | NO | FALSE | Admin lock on credit issuance |
| `updatedAt` | TIMESTAMP | NO | CURRENT_TIME| Timestamp of last change |

---

## 3. Database Integrity Constraints & Indexes

1. **Idempotency Protection**:
   ```sql
   CREATE UNIQUE INDEX idx_sales_tenant_idempotency
   ON sales ("tenantId", "idempotencyKey");
   ```
2. **Bill Sequence Per Store**:
   ```sql
   CREATE UNIQUE INDEX idx_sales_store_bill_number
   ON sales ("tenantId", "storeId", "billNumber");
   ```
3. **Credit Account Scope Isolation**:
   ```sql
   CREATE UNIQUE INDEX idx_cca_tenant_company_customer
   ON customer_credit_accounts ("tenantId", "companyId", "customerId");
   ```
4. **Ledger Idempotent Replays**:
   ```sql
   CREATE UNIQUE INDEX idx_khata_receivable_idempotency
   ON khata_receivable_entries ("tenantId", "idempotencyKey");
   ```
