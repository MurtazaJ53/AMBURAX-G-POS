# Architecture Decision Records (ADRs)

| Document ID | AMB-ADR-001 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Living Architectural Record |
| **Date** | 2026-10-19 | Authors | Technical Governance Board |

---

## ADR-001: Operational Ledger vs. ERP Ownership

- **Status**: Accepted
- **Context**: Retail POS counters require instant `< 200ms` checkouts. Directly writing into ERPNext Sales Invoices synchronously across HTTP introduces network latency and stops billing when the ERP undergoes maintenance.
- **Decision**: G-POS owns the operational sales ledger and double-entry stock movement locally in PostgreSQL. Transactions commit immediately, and an asynchronous Transactional Outbox pattern relays sales to ERPNext in the background.
- **Consequences**: Cashier checkout never stalls; ERP downtime does not block store counters.

---

## ADR-002: Double-Entry Inventory Stock Ledger

- **Status**: Accepted
- **Context**: Simple `inventory.stock_level = stock_level - 1` columns cause silent drift, prevent audits, and make fraud investigation impossible.
- **Decision**: Every stock alteration must be written as an immutable `StockMovement` entry (`SALE`, `PURCHASE_RECEIPT`, `TRANSFER_IN`, `TRANSFER_OUT`, `ADJUSTMENT`). The current on-hand stock is the authoritative sum of historical movements.
- **Consequences**: Every single piece of clothing or grocery is traceable to an invoice, receipt, or authorised adjustment.

---

## ADR-003: Single-Offer Enforcement with Counter Toggle

- **Status**: Accepted
- **Context**: In multi-buy retail, uncontrolled promotion stacking (e.g. 20% festive discount + Buy 2 Get 1 Free + Loyalty redemption) can exceed retail gross margin. Furthermore, merchants frequently ring up Udhar bills where they wish to withhold promotional discounts.
- **Decision**:
  1. Default to Single Best Offer per transaction.
  2. Implement an in-terminal F6 management modal allowing cashiers and store owners to select which offer applies, start/stop store offers, or clear/remove the offer entirely.
- **Consequences**: Prevents margin erosion while giving counter cashiers full flexibility.

---

## ADR-004: Continuous Udhar (Credit) Issuance

- **Status**: Accepted
- **Context**: In typical Indian retail and wholesale, long-standing trusted customers often make regular purchases on Udhar before clearing previous invoices at the end of the month. A rigid block on "overdue bills" caused checkout rejections.
- **Decision**: Relax the blocking `overdue_balance_exists` check at the POS counter. Allow continuous Udhar sales as long as the customer has a configured credit limit and sufficient remaining balance.
- **Consequences**: Respects real-world merchant-customer relationships while maintaining firm exposure ceilings.
