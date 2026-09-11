# AMBURAX POS — SCALABILITY

100k+ clients/data is an architecture target, not a proven capacity claim.

Scale dimensions:
tenants, POS terminals, API traffic, WebSockets, orders, marketplace jobs, ERPNext sites, analytics and AI workloads.

Principles:
stateless APIs where practical, Redis for cache/ephemeral state, durable event/job bus, isolated worker pools, connector rate limits, search/analytics separation, tenant-aware routing, backpressure, retries and idempotency.

Do not deploy dozens of microservices on day one. Split only when independent scaling, failure isolation, security, ownership or release cadence justifies it.

Capacity must be demonstrated with repeatable load tests.
