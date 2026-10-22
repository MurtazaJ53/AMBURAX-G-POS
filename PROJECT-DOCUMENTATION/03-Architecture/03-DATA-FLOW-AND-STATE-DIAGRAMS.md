# Data Flow and State Diagrams

| Document ID | AMB-ARCH-003 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Core Architecture Team |

---

## 1. POS Transaction State Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Idle: Cashier logs in / Shift open
    Idle --> Scanning: F1/F2 Barcode scan / Query
    Scanning --> CartPopulated: Line added / Price evaluated
    CartPopulated --> Scanning: Scan more items
    CartPopulated --> PromoApplied: F6 Offer selected / auto-evaluated
    CartPopulated --> Held: F4 Hold Cart
    Held --> CartPopulated: F4 Recall Cart
    PromoApplied --> Tendering: F8 / Payment selection
    Tendering --> SplitAllocated: F7 Split tender
    Tendering --> UdharEvaluated: Method = UDHAR
    UdharEvaluated --> Verified: Customer phone verified & within credit limit
    UdharEvaluated --> Refused: Credit mode blocked / Over credit limit
    Refused --> Tendering: Switch to Cash / UPI
    SplitAllocated --> Committing: Tenders equal Total
    Verified --> Committing: Authorised
    Committing --> SaleCompleted: ACID DB transaction commits
    SaleCompleted --> ReceiptPrinted: ESC/POS thermal print
    SaleCompleted --> OutboxEnqueued: Outbox event ready
    ReceiptPrinted --> Idle: Reset counter for next customer
```

---

## 2. Customer Khata Ledger Flow

```mermaid
flowchart LR
    A[Counter Sale with Udhar] -->|Post Debit| B[(khata_receivable_entries)]
    C[Customer Repayment Cash/UPI] -->|Post Credit| B
    D[Sale Return / Credit Note] -->|Post Credit| B
    E[Advance Deposit] -->|Post Credit| B
    
    B --> F{Balance Calculation}
    F -->|Sum Debits - Sum Credits| G[Current Outstanding Receivable]
    G --> H[Customer Ledger Statement & SMS Alert]
```
