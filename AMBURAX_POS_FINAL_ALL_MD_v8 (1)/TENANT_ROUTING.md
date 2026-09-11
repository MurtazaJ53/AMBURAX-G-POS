# AMBURAX POS — TENANT ROUTING

Every authenticated request resolves tenant context server-side. Never trust browser-supplied tenant identity.

Tenant scope is mandatory for:
- API/database queries
- authorization
- background jobs
- WebSockets
- Redis/cache keys
- search indexes
- object storage
- audit logs
- ERPNext credentials and site routing

Target:
CDN/WAF/LB → API Gateway → Identity/Tenant Router → domain services → ERPNext adapter → tenant-aware ERPNext site/cluster.

Cross-tenant read/write integration tests are mandatory before production.
