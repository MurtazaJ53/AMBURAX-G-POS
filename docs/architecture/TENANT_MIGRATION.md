# AMBURAX — Tenant and Cell Migration

Frozen 2026-09-13 (P1-7). Architecture only. Nothing is implemented; there is one cell.

## What migration must never change

**Tenant identity is permanent.** `tenantId` survives every move. So do:

- AMBURAX primary keys of every row the tenant owns
- external channel mappings and their external ids
- ERP mapping keys where the ERP placement itself does not change
- audit history and event history

Rewriting identifiers during a migration turns a move into a data-laundering exercise:
external systems that hold our ids (marketplaces, ERP, printed bills) would silently point
at nothing. This is invariant I-10 applied to operations.

## The two kinds of move

| Move | Example | Hard part |
|---|---|---|
| **Cell migration** | Cell A → Cell B, same region | Moving PostgreSQL data without losing in-flight writes |
| **ERP placement migration** | Pooled site → dedicated instance | Moving ERP state while its identifiers stay resolvable |

They are independent: a tenant can change cells without changing ERP placement, and the
reverse.

## Phases

```text
1. prepare    inventory the tenant's data; verify capacity and version compatibility at the
              target; snapshot placement metadata
2. copy       bulk copy at rest; tenant remains live and served by the source
3. validate   row counts, checksums, referential integrity, mapping completeness
4. sync       apply the delta accumulated since the copy, repeatedly, until it is small
5. switch     brief write freeze for this tenant -> final delta -> flip placement -> reopen
6. verify     smoke the critical paths as the tenant: sign in, read catalogue, ring a sale,
              read a bill, dispatch an event
7. rollback   defined window during which placement can be flipped back; source data is
              retained read-only and untouched
8. finalize   release the source data after the window closes
```

Frozen rules:

1. **Only the migrating tenant is frozen**, and only in phase 5. Other tenants on either
   cell are unaffected — this is the practical payoff of cell isolation.
2. **The outbox is drained before the switch.** Moving a tenant with undelivered events
   would strand them in the source cell's database. Drain, or copy the pending rows and
   verify the count on the far side.
3. **The rollback window is a real window**, with an owner and an expiry. A migration with
   no rollback plan is a one-way door pretending otherwise.
4. **Verification is behavioural, not just structural.** Matching row counts prove a copy;
   they do not prove the tenant can trade.

## Shared ERP pool to dedicated ERP

The ERP half follows the same phases with one addition: the mapping table is authoritative
for what must be reachable after the move. Any AMBURAX row holding an ERP identifier must
either still resolve at the new placement, or be remapped in the same transaction that
flips placement — never left dangling and reconciled afterwards.
