"""
ERPNext Migration / Maintenance Script: Drop Unique Constraint on AMBURAX Custom Fields
========================================================================================

Purpose:
  In ERPNext, integration tracking fields (such as `amburax_sale_id` on `Sales Invoice`)
  were initially created with `unique = 1`.

  When a document is cancelled in ERPNext (docstatus = 2), the cancelled document
  persists in the database and retains the tracking ID. A subsequent re-sync attempt fails
  with a uniqueness violation (e.g. `Amburax Sale ID must be unique`), forcing manual
  or programmatic deletion of the cancelled document. In a compliant GST accounting system,
  cancelled invoices and receipts must NEVER be deleted; they must remain for statutory
  audit trails.

Approach A (Approved):
  1. Remove `unique = 1` from `tabCustom Field` for integration fields across transactional doctypes:
     - Sales Invoice (`amburax_sale_id`)
     - Any return tracking fields or purchase receipt custom fields if defined.
  2. Drop underlying database unique indexes from MariaDB if present.
  3. Enforce active uniqueness in application adapter lookups:
     Lookups filter out `docstatus == 2` (cancelled), allowing fresh documents to be created
     and submitted while the cancelled documents remain intact in the database.

DO NOT RUN THIS SCRIPT UNTIL DIRECTED.
Execution Command (when approved):
  docker cp scripts/ops/drop_unique_amburax_sale_id.py frappe_docker-backend-1:/tmp/
  docker exec -i -w /home/frappe/frappe-bench frappe_docker-backend-1 /home/frappe/frappe-bench/env/bin/python -c \
    "import frappe; frappe.init('frontend', sites_path='sites'); frappe.connect(); import sys; sys.path.insert(0, '/tmp'); import drop_unique_amburax_sale_id; drop_unique_amburax_sale_id.run()"
"""

import frappe

# Doctypes and custom fields that track AMBURAX entities
TARGET_FIELDS = [
    {"dt": "Sales Invoice", "fieldname": "amburax_sale_id"},
    {"dt": "Purchase Receipt", "fieldname": "amburax_receipt_id"},
    {"dt": "Purchase Invoice", "fieldname": "amburax_invoice_id"},
    {"dt": "Purchase Receipt", "fieldname": "amburax_source_id"},
    {"dt": "Purchase Invoice", "fieldname": "amburax_source_id"},
]

def run():
    print("=" * 70)
    print("Starting audit and removal of unique constraints on AMBURAX custom fields...")
    print("=" * 70)

    changed_fields = []
    dropped_indexes = []

    for target in TARGET_FIELDS:
        dt = target["dt"]
        fieldname = target["fieldname"]

        # 1. Inspect Custom Field definition
        cf_name = frappe.db.get_value("Custom Field", {"dt": dt, "fieldname": fieldname}, "name")
        if cf_name:
            cf = frappe.get_doc("Custom Field", cf_name)
            if cf.unique:
                cf.unique = 0
                cf.save(ignore_permissions=True)
                changed_fields.append(f"{dt} -> {fieldname} (Custom Field: {cf_name})")
                print(f"[UPDATED] Custom Field '{cf_name}' on '{dt}': set unique = 0")
            else:
                print(f"[CLEAN] Custom Field '{cf_name}' on '{dt}' already has unique = 0")
        else:
            print(f"[SKIPPED] Custom Field for '{fieldname}' on '{dt}' does not exist")

        # 2. Inspect MariaDB table indexes for unique constraint
        table_name = f"tab{dt}"
        try:
            indexes = frappe.db.sql(
                f"SHOW INDEX FROM `{table_name}` WHERE Column_name = %s AND Non_unique = 0",
                (fieldname,),
                as_dict=True
            )
            for idx in indexes:
                key_name = idx.get("Key_name")
                if key_name and key_name != "PRIMARY":
                    print(f"[DROPPING INDEX] Unique index '{key_name}' on `{table_name}`...")
                    frappe.db.sql(f"ALTER TABLE `{table_name}` DROP INDEX `{key_name}`")
                    dropped_indexes.append(f"`{table_name}` index: {key_name}")
                    print(f"[DROPPED INDEX] '{key_name}' successfully removed from `{table_name}`")
        except Exception as e:
            # Table might not exist or field not in table schema
            pass

    frappe.db.commit()

    print("\n" + "=" * 70)
    print("MIGRATION SUMMARY:")
    print(f"  Total Custom Fields modified: {len(changed_fields)}")
    for item in changed_fields:
        print(f"    - {item}")
    print(f"  Total DB unique indexes dropped: {len(dropped_indexes)}")
    for item in dropped_indexes:
        print(f"    - {item}")
    print("=" * 70)
    print("Result: Cancelled documents can now be retained without blocking re-sync.")

if __name__ == "__main__":
    run()
