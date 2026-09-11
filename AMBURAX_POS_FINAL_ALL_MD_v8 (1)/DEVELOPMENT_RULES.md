# AMBURAX POS — Development Rules

1. Preserve the locked full scope.
2. No UI without backend ownership.
3. No backend behavior without source-of-truth mapping.
4. No privileged ERPNext credentials in clients.
5. No duplicate authoritative stock/accounting.
6. Critical mutations require idempotency.
7. Success requires backend/source confirmation.
8. No cross-service database writes.
9. Events are durable and observable.
10. Connectors need retry and reconciliation.
11. AI tools require identity, tenant, store, permission and policy checks.
12. High-risk AI actions require approval by default.
13. Every major screen has loading/empty/error/permission states.
14. Production needs tests, observability and rollback.
15. Do not optimize microservice count without evidence.
16. Update MD plans when architecture changes.
