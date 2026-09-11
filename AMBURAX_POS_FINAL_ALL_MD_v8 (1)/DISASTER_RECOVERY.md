# AMBURAX POS — DISASTER RECOVERY

A timeout must never be treated as a successful sale.

Required:
encrypted automated backups, restore testing, PITR where supported, defined RPO/RTO, runbooks, replayable/idempotent events, dead-letter handling, ERPNext reconciliation and recovery audit trail.

Offline POS:
durable local queue, explicit pending/confirmed/failed payment states, authoritative verification on reconnect and reconciliation after outages.

A backup is not proven until restore has been tested.
