# AMBURAX POS — Product Master Plan

## Product thesis
Run the physical store and online business from one system.

```text
BUY -> CATALOG -> STOCK -> STORE POS -> ONLINE -> FULFILL -> COLLECT -> RETURN -> RECONCILE -> ANALYZE -> AUTOMATE
```

## Major surfaces
- Retail
- Commerce
- B2B
- Back Office
- AI
- Platform/Admin

## Canonical models
Product -> Variant -> SKU -> Barcode
Location -> On Hand / Reserved / Available / Damaged / In Transit
Order -> Source / Channel / Customer / Items / Payment / Fulfillment / Shipment / Return / Refund
Channel -> Account / Capability / Schema / Listing / Mapping / Price / Inventory Policy

## Non-negotiable rules
1. No second authoritative stock ledger.
2. No second authoritative accounting ledger.
3. No privileged ERPNext credentials in clients.
4. Critical writes are idempotent.
5. AI never bypasses authorization.
6. Every channel integration has reconciliation.
7. Screen completion is not feature completion.
