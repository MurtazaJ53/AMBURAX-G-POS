# AMBURAX POS — Commerce Engine

## Core
Commerce is separate from POS, sharing the canonical catalog, inventory, customer and order core.

## Canonical mapping
```text
Amburax Variant
 -> Amazon listing
 -> Flipkart listing
 -> Shopify variant
 -> WooCommerce item
 -> future channel
```

## Channel Schema Engine
Common fields: name, SKU, images, description, brand, category, variants, price, MRP, weight, dimensions, HSN/tax data.
Channel-specific requirements are schema-driven.

## Publish
Select Products -> Select Channels -> Load Schema -> Map -> Validate -> Preview -> Publish -> External IDs -> Monitor.

## Allocation
ERPNext stock -> reservations -> available -> channel allocation policy.

## Order state
NEW -> CONFIRMED -> ALLOCATED -> PICKING -> PACKING -> READY_TO_SHIP -> SHIPPED -> DELIVERED
Branches: CANCELLED, PAYMENT_FAILED, RETURN_REQUESTED.

## Reconciliation
Orders, inventory, listings, prices, shipment, returns, refunds and settlement data where supported.
