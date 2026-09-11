# AMBURAX POS — Architecture

## Logical architecture
```text
Web / Tablet / Mobile
        |
     CDN/WAF
        |
 API Gateway / Edge
        |
 Auth + Retail API + Commerce API + AI API
        |
 Event / Job Bus
      /   \
 ERPNext  Integration Hub
   |            |
ERP Core     Channels/B2B
```

## Synchronous
Login, search, product/customer lookup, cart validation, final sale, payment confirmation, immediate approval.

## Asynchronous
Analytics, AI analysis, channel sync, bulk imports, notifications, webhook processing, reconciliation, large reports.

## Consistency
Authoritative commit -> durable outbox -> event -> idempotent consumers -> retry -> reconciliation.

## Failure isolation
AI outage must not stop POS.
Marketplace outage must not stop retail.
Analytics outage must not stop billing.
ERPNext outage must fail critical writes safely.
