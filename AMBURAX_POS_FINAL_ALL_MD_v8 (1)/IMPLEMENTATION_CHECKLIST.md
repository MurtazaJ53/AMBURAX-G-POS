# AMBURAX POS — Implementation Checklist

## Before a screen
- [ ] Domain owner
- [ ] Route/workspace
- [ ] API contract
- [ ] Service owner
- [ ] ERPNext/source-of-truth mapping
- [ ] Permission model
- [ ] State matrix

## Implementation
- [ ] Loading
- [ ] Empty
- [ ] Error
- [ ] Permission denied
- [ ] Offline/degraded where applicable
- [ ] Validation
- [ ] Audit
- [ ] Telemetry

## Critical transaction
- [ ] Idempotency
- [ ] Server validation
- [ ] Source confirmation
- [ ] Retry behavior
- [ ] Partial failure handling
- [ ] Reconciliation

## Commerce
- [ ] External ID mapping
- [ ] Capabilities
- [ ] Rate limits
- [ ] Webhook validation
- [ ] Retry/dead-letter
- [ ] Reconciliation

## AI
- [ ] Grounding
- [ ] Tool allowlist
- [ ] Permission
- [ ] Policy/approval
- [ ] Execution verification
- [ ] Audit

## Production
- [ ] Unit tests
- [ ] Integration tests
- [ ] Contract tests
- [ ] E2E smoke
- [ ] Observability
- [ ] Rollback
- [ ] Runbook
- [ ] Security review
