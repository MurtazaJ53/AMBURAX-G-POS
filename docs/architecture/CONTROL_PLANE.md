# AMBURAX — Control Plane, Data Plane, Intelligence Plane

Frozen 2026-09-13 (P1-7). Architecture only: no plane is physically separated today, and
this document says where each responsibility lives now as well as where it belongs.

## The three planes

```text
                              INTERNET
                                 |
                          CDN / WAF / LB
                                 |
                          TENANT ROUTER              resolves tenant -> region -> cell
                                 |
          +----------------------v----------------------+
          |            CONTROL PLANE (global)           |
          |  tenant · identity · RBAC/teams             |
          |  capabilities · billing · provisioning      |
          |  placement · feature flags                  |
          +----------------------+----------------------+
                                 |
                              REGION
                                 |
                   +-------------+-------------+
                   |                           |
                 CELL                        CELL
                   |
   +---------------v------------------------------+
   |              DATA PLANE (per cell)           |
   |  retail · wholesale · manufacturing          |
   |  job work · procurement · inventory          |
   |  distribution · commerce · CRM/khata         |
   |  APIs · workers · PostgreSQL · Redis         |
   |  outbox / events                             |
   +---------------+------------------------------+
                   |
            ERPNext Adapter          the only component that knows ERPNext
                   |
            ERP Placement            pooled or dedicated
                   |
              ERPNext (MariaDB)
```

The Intelligence Plane sits beside both and is privileged by neither:

```text
AI -> AI Gateway -> Context/Retrieval -> Typed Tool -> Permission
   -> Policy/Guardrail -> Domain Service -> Transaction
```

## Control plane

**Owns:** tenant identity and lifecycle, user identity, sessions and credentials, RBAC and
teams, capability configuration, billing and plan, placement metadata, provisioning
orchestration, feature flags.

**Boundary rules.**

1. The control plane is the only writer of tenant, placement and capability state. A data
   plane cell reads that state; it never authors it.
2. It holds no business transactions. No sale, stock movement, order or invoice exists in
   control-plane storage.
3. It is the single source of the answer to "which cell, which ERP placement, which
   capabilities" — a request that has not resolved these has no business reaching a domain
   service.

**Where it lives today:** logically, inside `apps/web` — `server/identity`, `server/tenant`,
`server/onboarding`, `server/pos` (device identity) and the `Tenant`, `User`, `Session`,
`StoreMembership`, `Invitation` models. There is one region, one cell and one PostgreSQL
database, so the plane split is a code boundary rather than a deployment boundary. That is
deliberate (ADR-017, ADR-020): split physically when independent scaling, failure isolation
or release cadence demands it, and not before.

**Placement metadata — the shape a tenant record must eventually carry:**

| Field | Meaning | Exists today |
|---|---|---|
| `tenantId` | Stable identity, never rewritten by any migration | Yes |
| `region` | Data residency and latency domain | No |
| `cellId` | Which cell serves this tenant | No |
| `tier` | Shared / large / dedicated | No (`BusinessType` is not a tier) |
| `erpPlacement` | Pool id or dedicated instance | Partial — `erpnextSiteId`, `NOT_PROVISIONED` |
| `erpVersion` | Pinned ERPNext version for this tenant | No (pinned globally in `ERPNext_VERSION_PIN.md`) |
| `status` | Provisioning / active / suspended / migrating | Partial — `TenantStatus`, `OnboardingStep` |
| `capabilities` | Enabled capability set | No — see CAPABILITIES.md |
| `featureFlags` | Per-tenant overrides | No |
| `resourceLimits` | Rate and quota ceilings | No |

None of the missing fields is added speculatively. They are recorded so the first migration
that needs one adds it to the right table with the right meaning.

## Data plane

**Owns:** everything transactional and operational — the domains listed in the diagram, the
APIs and workers that serve them, the tenant-scoped PostgreSQL data, Redis, and the outbox.

**Boundary rules.**

1. Every query is tenant-scoped (invariant I-1).
2. A cell is self-sufficient for serving its tenants: losing another cell must not stop it.
3. The data plane never talks to ERPNext directly (invariant I-5).
4. Cross-domain effects travel as events, not as direct writes into another domain's tables.

**Where it lives today:** `server/sales`, `server/catalog` (uncommitted, frontend-coupled),
`server/dashboard` (likewise), the `Product`/`ProductVariant`/`Customer`/`Sale`/`StockLevel`
models, and the outbox under `server/events`. One cell, one database.

## Intelligence plane

**Owns:** AI-assisted analysis, drafting and proposal. Owns no data and no authority.

**Boundary rules** (expanded in `AI_AUTOMATION.md`, frozen here):

1. AI reaches the system only through typed tools exposed by the AI Gateway. No arbitrary
   SQL, no direct Prisma access, no direct ERPNext call.
2. Every tool call is authorised as a user or service principal through the same RBAC path
   a human request takes (invariant I-8). AI has no privileged principal.
3. Risk classification decides autonomy: low-risk read/insight may auto-execute, medium
   risk requires policy approval, high risk — anything financial, stock-moving, credit-
   affecting, destructive or externally visible — requires human approval (ADR-012).
4. Every AI-initiated action is audited with the same correlation identifiers as a human
   one, plus the model and prompt version.

**Where it lives today:** nowhere. No AI code exists. The `/ai` route renders a planned-
module placeholder. This plane is specification only.
