# AMBURAX POS — ERPNext DocType / Capability Mapping

## Core ERP

| Amburax | ERPNext concept | Authority |
|---|---|---|
| Product | Item | ERPNext |
| Variant | Item Variant / Attributes | ERPNext |
| Category | Item Group | ERPNext |
| Brand | Brand | ERPNext |
| Store | Warehouse / Company setup | ERPNext configuration + Amburax store context |
| Sale | Sales Invoice / POS workflow | ERPNext |
| POS terminal (`PosDevice`) | *(none)* | Amburax |
| Payment | Payment Entry / POS payment | ERPNext |
| Customer Due | Receivable / outstanding | ERPNext |
| Customer Payment | Payment Entry | ERPNext |
| Purchase Order | Purchase Order | ERPNext |
| GRN | Purchase Receipt | ERPNext |
| Purchase Invoice | Purchase Invoice | ERPNext |
| Stock Transfer | Stock Entry | ERPNext |
| Stock Take | Stock Reconciliation | ERPNext |
| Delivery | Delivery Note | ERPNext |
| Shipment | Shipment / configured flow | ERPNext + Amburax orchestration |
| Supplier | Supplier | ERPNext |
| Employee | Employee | ERPNext |
| Attendance | Attendance | ERPNext |

## Amburax-owned extensions

- canonical channel identity
- channel account
- channel schema
- listing mapping
- inventory allocation policy
- online order normalization
- connector jobs
- sync error
- reconciliation case
- AI recommendation/action
- automation policy

## Adapter rule

Only the ERPNext Adapter knows ERPNext API details. Domain services use typed adapter commands/read models rather than raw ERPNext calls.

## Version rule

Production must pin an ERPNext/Frappe version and contract-test upgrades.

## Store provisioning contract (established by A7, not yet implemented)

No ERPNext adapter exists yet (Phase 2). A7 (Store Setup) added `Store.erpnextProvisionStatus`
(`NOT_PROVISIONED | PROVISIONING | PROVISIONED | FAILED` — reusing Tenant's existing enum,
not a new one) and `Store.erpnextWarehouseId`, and leaves both at their defaults. Rather
than write a speculative adapter interface with no implementation and no caller (a form of
the "dangerous half-integration" this architecture rejects), the contract Phase 2 must
implement is documented here instead:

```text
provisionWarehouse(tenantId, storeId, storeName, storeCode)
  -> { status: 'PROVISIONED', erpnextWarehouseId } | { status: 'FAILED', reason }
```

Called asynchronously after Store creation commits (never inline in the A7 request/response
cycle — provisioning ERPNext state is not a synchronous concern of onboarding). On success,
updates `Store.erpnextProvisionStatus` + `erpnextWarehouseId`. On failure, sets `FAILED` and
surfaces it through whatever operational/notification surface Phase 2 defines — never
silently retried forever, never reported to the merchant as success.
