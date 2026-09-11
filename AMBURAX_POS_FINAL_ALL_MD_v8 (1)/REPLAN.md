# AMBURAX POS — REPLAN v8

## Why
The ERPNext/proprietary boundary is now a hard architecture requirement. The next move is repository reality validation, not another screen.

## Stop
- Do not build A10/A12 yet.
- Do not perform a broad repository restructure yet.
- Do not fork/copy ERPNext.
- Do not add Frappe apps casually.
- Do not claim license compliance before audit.

## Do
1. Audit git/repository/source tree.
2. Identify exact ERPNext/Frappe versions and integration method.
3. Audit licenses, dependencies and secrets.
4. Verify tenant isolation/auth/database/migrations.
5. Map actual repo to target architecture.
6. Produce gap report.
7. Fix P0 blockers only.
8. Freeze architecture.
9. Resume feature implementation.

## Required audit outputs
REPO_AUDIT.md
LICENSE_RECONCILIATION.md
ERPNext_VERSION_PIN.md
DATA_OWNERSHIP_MATRIX.md
ARCHITECTURE_GAPS.md
ARCHITECTURE_FREEZE.md
NEXT_EXECUTION_PLAN.md
