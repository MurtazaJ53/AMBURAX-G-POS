# AMBURAX POS — ERPNext / FRAPPE VERSION PIN

Audit date: 2026-09-11
Status: **NOTHING TO PIN — ERPNext IS NOT PRESENT IN THIS REPOSITORY.**

---

## 1. Discovered versions

| Component | Version discovered | Evidence |
|---|---|---|
| ERPNext | **NOT INSTALLED** | no source, no app, no container, no client |
| Frappe Framework | **NOT INSTALLED** | same |
| MariaDB (Frappe's DB) | **NOT INSTALLED** | the only datasource is PostgreSQL |
| Python / bench | **NOT PRESENT** | no `requirements.txt`, no `pyproject.toml`, no `apps.txt`, no `sites/` |

This is a statement of fact from inspection, not an inference from documentation.

## 2. How this was determined

```
grep -rIl --exclude-dir=node_modules --exclude-dir=.next -i 'erpnext|frappe' .
```

Returns **30 files, every one of them a Markdown specification** inside
`AMBURAX_POS_FINAL_ALL_MD_v8 (1)/`. Zero source files matched.

```
grep -rn --include=*.ts --include=*.tsx -i 'erpnext|frappe' src/ | grep -i 'import|require|fetch|http'
```

Returns **nothing**. There is no import of, HTTP call to, or client for ERPNext
anywhere in the application.

The only occurrences of the string `erpnext` in source are:

- `prisma/schema.prisma` — the fields `Tenant.erpnextProvisionStatus`,
  `Tenant.erpnextSiteId`, `Store.erpnextProvisionStatus`, `Store.erpnextWarehouseId`
- `src/server/tenant/storeSetup.ts` — comments and the default `NOT_PROVISIONED`
- `src/server/pos/posDeviceSetup.ts` — a comment explaining why `PosDevice` has
  **no** ERPNext field
- `src/server/onboarding/readiness.ts` — reads provision status to report
  inventory as `UNAVAILABLE`
- three test files asserting the above

These are **placeholders for a future integration**, all sitting at their
`NOT_PROVISIONED` default. They are not an integration.

## 2b. Which version to pin, and why (P1-7)

**No version can be pinned yet, because nothing is installed.** What P1-7 settles is the
*criteria*, so that the choice at implementation time is made on evidence rather than
whatever is newest that week:

1. **A currently-supported major, never the newest release.** A `.0` carries migration risk
   and thin community coverage; the newest is exactly where adapter-breaking changes live.
2. **Frappe and ERPNext pinned together.** ERPNext depends on a specific Frappe major.
   Recording one without the other is not a pin.
3. **A version with a stated support window** long enough to cover the planned Phase 2-5
   build, so an EOL does not force an upgrade mid-build.
4. **MariaDB version pinned alongside**, since Frappe constrains it.
5. **Contract-tested before adoption** — see section 8 of ERPNEXT_ARCHITECTURE.md.

**Deliberately not naming a version here.** The current ERPNext release and support calendar
must be read at implementation time from the vendor, not asserted from memory in this
document; stating a version that later proves wrong would be worse than stating none. The
last major this project can speak to with any confidence is the v15 line, and even that must
be re-checked rather than trusted.

## 3. Support / EOL status

**Not applicable.** No version is deployed, so there is no support window, no EOL
date, and no upgrade decision to make. Per the standing instruction — *"Do not
upgrade merely because an upgrade is recommended"* — no upgrade is recommended
here, because there is nothing to upgrade.

When ERPNext is first introduced, this document must be replaced with the actual
pinned versions and their support windows, captured from the running deployment
(`bench version`), not from documentation.

## 4. Integration method

**None exists.** The intended method per ARCHITECTURE.md is orchestration via an
adapter layer, with the frontend never contacting ERPNext directly. That
constraint is currently satisfied trivially — there is no ERPNext to contact and
no credential to leak.

**Trivially satisfied is not the same as proven.** The first ERPNext commit is
the moment the boundary becomes real, and it must land inside a separate
`amburax_erp` layer, never inside `apps/web`.

## 5. What this means for the architecture rules

| Rule | Current state |
|---|---|
| AMBURAX code separate from ERPNext customization | **Satisfied — vacuously.** No ERPNext code exists to be mixed in. |
| Frontend independently implemented | **Satisfied and verified.** Next.js/React, zero ERPNext frontend assets, no copied source. |
| ERPNext is the ERP engine underneath | **Not yet true.** There is no ERP engine. Stock, accounting, tax and invoicing do not exist anywhere in the system. |
| ERPNext customization in `amburax_erp` | **N/A** — the layer does not exist and is not yet needed. |
| No ERPNext core modification | **Satisfied** — no core to modify. |
| No Frappe apps without license review | **Satisfied** — no Frappe apps installed. |

## 6. Consequence for product claims

Because no ERP engine exists, the following are **not implemented anywhere**:
stock ledger, stock entries, purchase/sales invoices, payment entries,
receivables, accounting/GL, and tax/GST.

A10's readiness calculation reports `inventory` as `UNAVAILABLE` and `payments`
as `UNAVAILABLE` for exactly this reason, and `operationalReady` is consequently
`false` for every tenant. That is the honest result and must not be "fixed" by
loosening the check.

## 7. Required before this file can be filled in

1. Decide the deployment shape (managed Frappe Cloud vs self-hosted bench vs container).
2. Stand up one instance and record `bench version` output verbatim here.
3. Record the MariaDB version, since Frappe requires MariaDB while AMBURAX uses PostgreSQL —
   **this is a two-database architecture and that decision is not yet documented anywhere.**
4. Record the support/EOL window for the chosen ERPNext major version.
5. Create `amburax_erp` as a separate app before the first customization.
