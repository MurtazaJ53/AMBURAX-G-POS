# Khata (Customer Credit) Ledger Engine

| Document ID | AMB-MOD-004 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Financial Ledger Architecture Team |

---

## 1. Credit Ledger Invariants

The Khata engine (`creditSalePosting.ts`, `khataService.ts`) implements an immutable double-entry credit ledger for B2B and retail credit customers:

1. **Company Scoping**: Exposure belongs to the legal Company entity. A customer cannot use credit granted by Company A at Company B's stores.
2. **Phone Verification Gate**: Customers must complete mobile SMS OTP verification before the system permits any Udhar transaction.
3. **Continuous Udhar Support**:
   - Merchants can issue multiple subsequent Udhar sales without requiring old or past due invoices to be cleared first.
   - The blocking check `overdue_balance_exists` is relaxed at the counter to support real-world merchant relationships, provided the total debt remains within the customer's credit limit.
4. **Pure Udhar (₹0 Down Payment)**:
   - Customers can purchase items on full credit (`udharPaidMinor = 0`). The entire net bill amount (`onAccountMinor = totals.totalMinor`) posts to their Khata.

---

## 2. Ledger Calculation Formula

The customer's net receivable balance is calculated as:

$$\text{Net Outstanding Due} = \sum (\text{DEBIT\_CREDIT\_SALE} + \text{DEBIT\_REVERSAL}) - \sum (\text{CREDIT\_REPAYMENT} + \text{CREDIT\_RETURN} + \text{CREDIT\_ADVANCE})$$

- Invariant Rule: Total credits must never exceed total debits in an authoritative asset ledger.
- If credits exceed debits, the system flags the account as `inconsistent_ledger_state` and alerts the administrator.
