# AMBURAX POS — Observability

Track:
- POS success and latency
- payment failures
- ERPNext failures/latency
- queue age
- channel sync lag
- webhook failures
- inventory mismatches
- reconciliation backlog
- AI recommendation/action failures
- auth failures

Every important trace follows:
Client -> API -> Domain -> ERPNext/Connector -> Event -> Consumer.

Use structured logs with request/correlation IDs. Never log secrets.
