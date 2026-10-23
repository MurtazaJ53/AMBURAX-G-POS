"""
ERPNext Migration / Maintenance Script: Drop Unique Constraint on amburax_sale_id
==================================================================================

Purpose:
  In ERPNext, Custom Field `amburax_sale_id` on doctypes (such as `Sales Invoice`)
  was initially defined with `unique = 1`.
  
  When an invoice is cancelled in ERPNext (docstatus = 2), the cancelled document
  still holds `amburax_sale_id`. A subsequent re-sync attempt fails with
  `Amburax Sale ID must be unique`, forcing operational deletion of cancelled invoices.
  In a compliant GST accounting system, cancelled invoices must NEVER be deleted.

Solution (Approach A):
  1. Remove `unique = 1` from `tabCustom Field` where `fieldname = 'amburax_sale_id'`.
  2. Drop the underlying database unique index from MariaDB if present (`unique_amburax_sale_id`).
  3. Enforce active uniqueness in the application adapter lookup:
     Only active documents (`docstatus != 2`) are matched to an AMBURAX entity.
     Any cancelled invoice (`docstatus == 2`) is retained for statutory audit trails,
     allowing a fresh invoice to be created cleanly without constraint violations.

DO NOT RUN THIS SCRIPT UNTIL DIRECTED.
Execution Command (when approved):
  docker cp scripts/ops/drop_unique_amburax_sale_id.py frappe_docker-backend-1:/tmp/
  docker exec -i -w /home/frappe/frappe-bench frappe_docker-backend-1 /home/frappe/frappe-bench/env/bin/python -c \
    "import frappe; frappe.init('frontend', sites_path='sites'); frappe.connect(); import sys; sys.path.insert(0, '/tmp'); import drop_unique_amburax_sale_id; drop_unique_amburax_sale_id.run()"
"""

import frappe

def run():
    print("Checking Custom Field 'amburax_sale_id' on 'Sales Invoice'...")
    cf_name = frappe.db.get_value("Custom Field", {"dt": "Sales Invoice", "fieldname": "amburax_sale_id"}, "name")
    if cf_name:
        cf = frappe.get_doc("Custom Field", cf_name)
        if cf.unique:
            cf.unique = 0
            cf.save(ignore_permissions=True)
            print(f"Updated Custom Field {cf_name}: set unique = 0.")
        else:
            print(f"Custom Field {cf_name} already has unique = 0.")
    else:
        print("Custom Field 'amburax_sale_id' on 'Sales Invoice' not found.")

    # Check and drop unique database indexes if present on tabSales Invoice
    indexes = frappe.db.sql(
        "SHOW INDEX FROM `tabSales Invoice` WHERE Column_name = 'amburax_sale_id' AND Non_unique = 0",
        as_dict=True
    )
    for idx in indexes:
        key_name = idx.get("Key_name")
        if key_name and key_name != "PRIMARY":
            print(f"Dropping unique index {key_name} on `tabSales Invoice`...")
            frappe.db.sql(f"ALTER TABLE `tabSales Invoice` DROP INDEX `{key_name}`")
            print(f"Index {key_name} dropped.")

    frappe.db.commit()
    print("Completed successfully. Cancelled documents can now be retained without blocking re-sync.")

if __name__ == "__main__":
    run()
