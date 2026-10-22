# Inventory & Stock Movement Ledger

| Document ID | AMB-MOD-003 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Inventory Architecture Team |

---

## 1. Double-Entry Stock Movement Mechanics

In AMBURAX G-POS, inventory is managed using double-entry operational movements (`stockLedger.ts`). Inventory levels are computed dynamically or verified against materialized ledger projections:

$$\text{Current Available Stock} = \sum (\text{DEBIT movements}) - \sum (\text{CREDIT movements}) - \text{Active Reservations}$$

| Movement Type | Delta | Triggering Event |
| :--- | :--- | :--- |
| `SALE` | Negative (`-N`) | POS Counter checkout completed |
| `PURCHASE_RECEIPT` | Positive (`+N`) | Goods received from vendor against Purchase Order |
| `TRANSFER_IN` | Positive (`+N`) | Stock received from another company store |
| `TRANSFER_OUT` | Negative (`-N`) | Stock dispatched to another store location |
| `ADJUSTMENT` | Positive/Negative | Physical stock count audit adjustment / write-off |
| `RETURN` | Positive (`+N`) | Customer returns undamaged item to stock |

---

## 2. Sellable Stock vs. Reservations

To prevent selling the same garment twice across concurrent counter tills or live checkout sessions:
- When an item enters an active checkout sequence, an ephemeral reservation is created.
- The `assertSellable()` service validates that:
  $$\text{Variant Stock} - \text{Active Reservations} \ge \text{Requested Quantity}$$
- If stock is insufficient, the cashier receives an immediate warning:
  `"Only 1 unit available; remainder reserved for active counter checkout."`
