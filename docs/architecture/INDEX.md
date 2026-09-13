# AMBURAX — Architecture Documentation Index

P1-7 architecture freeze, recorded 2026-09-13 against commit `c244f00`.

## Why this directory exists, and why it is small

AMBURAX already has a 51-document architecture corpus in
`AMBURAX_POS_FINAL_ALL_MD_v8 (1)/`. That corpus is the home of the product's architecture
and stays the home of it. This directory adds only the documents that had no equivalent
there, and points at the existing ones for everything else. Duplicating twenty documents
into a parallel tree would create two sources of truth about a system whose central
architectural rule is that there is only ever one.

## Documents added here

| Document | Covers | Why it is new |
|---|---|---|
| [P1_7_FREEZE.md](P1_7_FREEZE.md) | The freeze record: what is frozen, what is explicitly not, contradiction audit | The freeze itself |
| [ARCHITECTURE_INVARIANTS.md](ARCHITECTURE_INVARIANTS.md) | The rules future code must obey, and which are machine-enforced today | Rules existed as prose scattered across docs; never as a checkable list |
| [CONTROL_PLANE.md](CONTROL_PLANE.md) | Control/data/intelligence plane split, tenant router, placement metadata | No document described the three planes |
| [CAPABILITIES.md](CAPABILITIES.md) | Capability model, dependencies, activation, gating | Capabilities were named in the plan but never specified |
| [CELL_ARCHITECTURE.md](CELL_ARCHITECTURE.md) | Region/cell model, placement, failure isolation, multi-region posture | No cell document existed |
| [ERP_ADAPTER.md](ERP_ADAPTER.md) | The adapter contract: interface, errors, retries, idempotency, mapping | `ERPNEXT_ARCHITECTURE.md` settles placement, not the boundary contract |
| [PROVISIONING.md](PROVISIONING.md) | Tenant provisioning state machine and compensation | Onboarding was documented; provisioning was not |
| [TENANT_MIGRATION.md](TENANT_MIGRATION.md) | Moving a tenant between cells or ERP placements | No migration document existed |
| [INVENTORY.md](INVENTORY.md) | Inventory ledger authority, projection invariant, concurrency, opening-balance backfill (P1-8B) | Added when the ledger was built |
| [UOM.md](UOM.md) | Unit catalogue, exact integer conversion contract, product base unit, why decimals are deferred (P1-8C) | Added when units arrived |

## Documents updated in the existing corpus

| Document | What P1-7 changed |
|---|---|
| `ARCHITECTURE_FREEZE.md` | Verdict updated: decision freeze recorded, proof gates kept open and named |
| `DATA_OWNERSHIP_MATRIX.md` | Corrected — the retail slice shipped tables the matrix still described as NOT IMPLEMENTED |
| `EVENTS.md` | Each event marked IMPLEMENTED / PLANNED, with producer and idempotency key |
| `DECISIONS.md` | ADR-083 … ADR-092 appended |
| `PERMISSIONS.md` | Target model kept; implemented subset recorded honestly |

## Documents deliberately not created

`MULTI_REGION.md` is a section of [CELL_ARCHITECTURE.md](CELL_ARCHITECTURE.md) rather than
its own file — there is one region today and a separate document would be a page of
conditional statements. `DATABASE_STRATEGY.md`, `TENANT_ROUTING.md`, `OBSERVABILITY.md`,
`DISASTER_RECOVERY.md`, `CAPACITY_TESTING.md`, `SECURITY.md`, `COMMERCE_ENGINE.md`,
`AI_AUTOMATION.md` and `SCALABILITY.md` already exist in the corpus and were found accurate
for the current system; P1-7 references them rather than restating them.
