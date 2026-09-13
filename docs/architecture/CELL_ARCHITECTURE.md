# AMBURAX — Cell Architecture, Placement and Multi-Region

Frozen 2026-09-13 (P1-7). Architecture only. Today there is **one region, one cell, one
PostgreSQL database, and no ERPNext**. Nothing here is deployed.

## The model

```text
Region (e.g. ap-south)
 ├── Cell A          AMBURAX services · PostgreSQL · Redis · workers · ERP placement
 ├── Cell B
 └── Cell C
```

A **cell** is a complete, independently operable slice of the data plane serving a bounded
set of tenants. A cell failure must degrade its tenants only.

**Why cells rather than one large cluster:** blast radius. A shared everything-cluster makes
every incident a platform incident and makes a noisy tenant everyone's problem. Cells convert
an outage into a subset outage, give a natural migration unit, and let capacity be reasoned
about per cell instead of per platform.

**Why not one cell per tenant:** cost and operational surface. Thousands of isolated stacks
is not isolation, it is a fleet nobody can patch.

## Tenant placement

Placement is control-plane state (see [CONTROL_PLANE.md](CONTROL_PLANE.md)). A tenant is
assigned a region and cell at provisioning and keeps both until an explicit migration.

Routing:

```text
request -> CDN/WAF/LB -> tenant router -> resolve tenant -> region -> cell -> service
```

Frozen rules:

1. The router resolves tenant identity from authenticated session context, never from a
   client-asserted tenant header (invariant I-1).
2. `tenantId` is stable across every migration. A tenant that moves cells keeps its identity,
   its external mappings and its ERP identifiers (see [TENANT_MIGRATION.md](TENANT_MIGRATION.md)).
3. A cell never queries another cell's database. Cross-cell data movement is a migration
   operation, not a runtime feature.

## Tiers

| Tier | Shape | When |
|---|---|---|
| **Shared** | Many tenants per cell, shared PostgreSQL, pooled ERP sites | Default |
| **Large** | Shared cell, dedicated ERP resources, possibly dedicated database | Volume or noisy-neighbour evidence |
| **Dedicated** | Own cell or own environment | Contractual isolation, residency, or scale |

Promotion between tiers is a migration, not a redeploy, and is triggered by measured load —
never by assumption.

## Failure isolation

| Failure | Expected behaviour |
|---|---|
| One cell down | Only that cell's tenants affected; other cells unaware |
| ERP placement down | Domain operations that need ERP fail explicitly; POS behaviour is the open question in ADR-078; events queue in the outbox |
| Outbox transport down | Business transactions continue; events accumulate PENDING and drain on recovery (proven by design, F-01) |
| Control plane down | Existing sessions continue; provisioning, capability changes and placement changes stop |
| Redis down | Cache misses degrade latency; correctness must not depend on cache presence |

The last row is a constraint on future code, not an observation: nothing may be stored only
in Redis that the system needs to be correct.

## Multi-region

There is one region. The architecture keeps the option open by:

1. Making `region` part of placement metadata rather than an environment variable.
2. Forbidding cross-cell runtime queries, which is the same rule that makes cross-region
   work later.
3. Keeping tenant identity stable and independent of location.

**Not decided, deliberately:** active-active versus active-passive, cross-region replication
strategy, and data-residency commitments. None can be chosen honestly without a customer
requirement and a latency budget. Recorded as open in [P1_7_FREEZE.md](P1_7_FREEZE.md).

## Capacity — variables, not numbers

Everything below is unknown and must be measured. No value is asserted anywhere in this
repository, and none may be quoted in sales material until a benchmark exists
(`CAPACITY_TESTING.md` defines the harness).

| Variable | Why it decides cell sizing |
|---|---|
| Tenants per cell | The primary placement decision |
| PostgreSQL connections per service instance | Usually the first hard ceiling |
| Sustained and peak transactions per second | Drives instance count |
| ERPNext sites per Frappe pool | Drives ERP placement density |
| Outbox dispatch throughput per runner | Decides runner count and batch size |
| Worker throughput per queue | Decides worker pool sizing |
| Commerce sync throughput per channel | Bounded by each channel's rate limits |
| Real-time connection count per instance | Only relevant once real-time exists |
| Backup and restore duration per tenant and per cell | Sets the achievable RTO |

The correct public statement of scale is: *the architecture is designed to scale toward
100k+ tenants through regional cell placement, tenant routing, database isolation evolution
and workload segmentation; capacity limits remain benchmark-dependent.* Not: "AMBURAX
supports 100k tenants."
