# AMBURAX POS — DATABASE STRATEGY

AMBURAX PostgreSQL owns platform/domain data. ERPNext owns authoritative ERP records.

AMBURAX:
tenant/platform identity, commerce mappings, channel state, sync jobs/events, allocation policy, AI state, operational read models, B2B pipeline, platform audit metadata.

ERPNext:
accounting, GL, stock ledger, ERP stock transactions, financial documents, purchasing/accounting records.

Never create a second authoritative stock ledger or accounting engine.

Requirements:
versioned migrations, tenant-scoped queries, durable idempotency, durable events/audit, tested backups, backward-compatible deploys, analytics isolation from OLTP.

Scale path:
PostgreSQL → read models/replicas → proven partitioning → search/analytics stores → tenant-tier isolation.
