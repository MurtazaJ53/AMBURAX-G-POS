# Migration and Reconciliation Policies

| Document ID | AMB-DB-003 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Database & SRE Team |

---

## 1. Migration Protocol (Prisma & Zero-Downtime DDL)

To maintain 24/7 store operations across retail locations:
1. **Expand and Contract Pattern**:
   - New columns must always be introduced as `NULLABLE` or with safe defaults.
   - Code reading both old and new columns is deployed before writing exclusively to the new column.
   - Deprecated columns are dropped only in subsequent release cycles.
2. **Migration Command Execution**:
   ```bash
   # Development environment
   npx prisma migrate dev --name <migration_name>

   # Production automated deployment
   npx prisma migrate deploy
   ```
3. **Lock Safety**:
   - Avoid long-running table locks during counter billing hours (09:00 to 22:00 IST).
   - Heavy backfills run in micro-batches with transaction timeouts (`statement_timeout = '5s'`).

---

## 2. Daily Financial & Inventory Reconciliation Policies

### 2.1 Cash Register / Tender Reconciliation
At the end of each shift or business day:
- **Cashier Count**: The physical cash in drawer is counted and entered into the terminal.
- **System Expected**: The system computes `Opening Float + Cash Sales - Cash Returns - Payouts`.
- **Variance Analysis**:
  - `Variance = Physical Cash - System Expected`.
  - Discrepancies > ₹100 trigger an automated alert to the Store Manager and generate an audit record.

### 2.2 Khata Ledger Balance Integrity Check
Automated daily scheduled jobs execute ledger verification queries:
```sql
-- Invariant: Authoritative Khata sum must equal customer receivable snapshot
SELECT
  cca."id",
  (SUM(CASE WHEN kre."entryType" IN ('DEBIT_CREDIT_SALE', 'DEBIT_REVERSAL') THEN kre."amountMinor" ELSE 0 END) -
   SUM(CASE WHEN kre."entryType" IN ('CREDIT_REPAYMENT', 'CREDIT_SALE_RETURN', 'CREDIT_ADVANCE_APPLY', 'CREDIT_REVERSAL') THEN kre."amountMinor" ELSE 0 END)) AS computed_receivable
FROM "customer_credit_accounts" cca
JOIN "khata_receivable_entries" kre ON kre."creditAccountId" = cca."id"
GROUP BY cca."id";
```
- Invariant Rule: Total credits can never exceed total debits in an authoritative asset ledger.
- If credits exceed debits, the system flags the account as `inconsistent_ledger_state` and alerts the financial administrator.
