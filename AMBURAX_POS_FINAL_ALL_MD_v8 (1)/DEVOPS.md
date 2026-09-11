# AMBURAX POS — DevOps

## Environments
local -> development -> staging -> pilot -> production

## Platform
CDN/WAF, gateway, containers, ERPNext, database, Redis/cache, event/queue bus, object storage, secrets manager, logs, metrics, traces.

## Release
lint -> typecheck -> unit -> integration/contract -> security scan -> E2E smoke -> staged deploy -> rollback plan.

## Reliability
timeouts, retries, backoff, idempotency, DLQ, circuit breaking where justified, reconciliation.

## DR
regular restore and event-replay tests.
