# CLAUDE CODE — NEXT COMMAND

Paste the following as one instruction into Claude Code:

```text
You are the Senior Software Architect + Principal Engineer for AMBURAX POS.

STOP FEATURE DEVELOPMENT FOR THIS TURN.

Do NOT build A10, A12, or any new screen.
Do NOT perform a broad repository restructure.
Do NOT copy, fork, or rewrite ERPNext source/frontend.
Do NOT make speculative fixes.

TASK: REPOSITORY REALITY AUDIT + ARCHITECTURE/COMPLIANCE GAP ANALYSIS.

HARD RULES:
1. AMBURAX proprietary code must remain separate from ERPNext/Frappe customization.
2. AMBURAX frontend is independently implemented; do not copy ERPNext frontend.
3. ERPNext is the ERP engine underneath AMBURAX.
4. ERPNext-specific customization belongs in a separate amburax_erp layer/app.
5. API separation is not a blanket GPL exemption.
6. Do not modify ERPNext core unless the audit proves necessity and records why.
7. Do not add Frappe apps without license review.
8. Unknown license = BLOCKED.
9. SaaS-first is current; self-hosted distribution is not being implemented.
10. Preserve the 125-screen roadmap and original 81-screen scope.
11. Verify A1-A14 from actual code/tests; do not trust old reports blindly.
12. A9 device identity does not mean offline POS is implemented.

PHASE 1 — READ-ONLY REPOSITORY INVENTORY
- Run git status --short and git status.
- Record branch, remotes and recent commits.
- Inspect repository root and source tree.
- Identify package managers and lockfiles.
- Identify apps/, services/, packages/, scripts/, infra/, Docker/compose.
- Identify ERPNext/Frappe source, custom apps, submodules, vendored/copied code.
- Identify frontend/backend boundaries.
- Identify DB configuration and migration system.
- Inspect env/config files without printing secret values.
- Locate auth/session/tenant/authorization code.
- Verify A1-A14 evidence.
- Verify A9 POS device activation and whether offline storage/queue/sync exists.

PHASE 2 — ERPNEXT AUDIT
- Find exact ERPNext/Frappe versions.
- Determine installation/deployment/integration method.
- Find custom Frappe apps, hooks, patches, fixtures, DocTypes and overrides.
- Detect direct ERPNext/Frappe imports inside proprietary AMBURAX packages.
- Detect copied ERPNext source or frontend assets.
- Do not modify production code.

PHASE 3 — SECURITY
- Run safe available secret scanning.
- Search for hardcoded passwords, API keys, private keys, session secrets, DB credentials and tokens without echoing values.
- Verify tenant isolation and authorization.
- Verify browser code cannot obtain privileged ERPNext credentials.
- Check logs for credential/token leakage.

PHASE 4 — LICENSE/SBOM
- Inspect manifests and lockfiles.
- Generate dependency/license inventory using local tooling.
- Separate AMBURAX proprietary, ERPNext/Frappe and third-party code.
- Flag GPL/AGPL/copyleft/unknown licenses.
- Do not make legal conclusions; report engineering risks.

PHASE 5 — QUALITY
Run the repository's existing appropriate tests, typecheck, lint, build and migration validation. Do not invent destructive commands. Record exact failures and classify P0/P1/P2/P3.

PHASE 6 — ARCHITECTURE GAP
Compare ACTUAL repository state against:
- 125-screen roadmap
- proprietary/ERPNext boundary
- tenant routing
- database strategy
- scalability
- capacity testing
- disaster recovery
- API contracts
- events/outbox
- permissions
- offline POS
- commerce engine

CREATE/UPDATE ONLY THESE AUDIT DOCUMENTS:
1. REPO_AUDIT.md
2. LICENSE_RECONCILIATION.md
3. ERPNext_VERSION_PIN.md
4. DATA_OWNERSHIP_MATRIX.md
5. ARCHITECTURE_GAPS.md
6. ARCHITECTURE_FREEZE.md
7. NEXT_EXECUTION_PLAN.md

ERPNext_VERSION_PIN.md must state discovered exact versions and support/EOL status. Do not upgrade merely because an upgrade is recommended; report it separately unless an existing safe migration process proves otherwise.

DATA_OWNERSHIP_MATRIX.md must classify important domains as:
AMBURAX MASTER / ERPNEXT MASTER / SHARED-ORCHESTRATED / READ MODEL.

ARCHITECTURE_GAPS.md:
P0 = security/data-loss/license-critical blocker
P1 = architecture/integrity blocker
P2 = important follow-up
P3 = future improvement

FINAL RESPONSE:
- executive summary
- exact git status
- exact ERPNext/Frappe versions
- proprietary vs ERPNext findings
- license/SBOM findings
- security findings
- test/build findings
- P0/P1 blockers
- smallest safe next implementation step

MOST IMPORTANT:
INSPECT FIRST. REPORT SECOND. MODIFY ONLY THE AUDIT DOCUMENTS IN THIS TURN.
Do not claim architecture is frozen unless evidence supports it.
```

After Claude completes this audit, stop. Bring the generated audit files/report back for review before issuing the next implementation command.
