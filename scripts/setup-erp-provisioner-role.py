# Creates the "AMBURAX Provisioner" role and its user on one ERPNext site: the least-privilege
# identity that sets up a new business's company (provisioning, TenantProvisioner). Owner-approved
# 2026-10-25. Idempotent. Never creates API keys: the owner generates those in the ERPNext desk.
#
#   docker cp scripts/setup-erp-provisioner-role.py frappe_docker-backend-1:/tmp/
#   docker exec -w /home/frappe/frappe-bench/sites frappe_docker-backend-1 \
#     /home/frappe/frappe-bench/env/bin/python /tmp/setup-erp-provisioner-role.py <site> [--dry-run]
#
# Run on a scratch site first, never on a real site first.

import argparse

import frappe

ROLE = "AMBURAX Provisioner"
USER = "amburax-provisioner@dev.local"

# What provisioning creates or changes. Never submit, cancel or delete: every transactional document
# is synced by the integration user, not this one.
REQUIRED_PERMISSIONS = {
    "Company": ("read", "create", "write"),
    "Account": ("read", "create", "write"),
    "Tax Category": ("read", "create", "write"),
    "Purchase Taxes and Charges Template": ("read", "create", "write"),
    "Fiscal Year": ("read", "create", "write"),
    # Links Cash / UPI / Credit Card to this company's accounts (Mode of Payment Account rows).
    "Mode of Payment": ("read", "create", "write"),
    # Not Warehouse or Address: a Warehouse is created whenever a store is added (ErpStoreAdapter)
    # and the company Address whenever GST is switched on (ErpCompanyGstAdapter). That is day-to-day
    # outbox work, done by the integration user, not one-time setup.
}
ALL_RIGHTS = ("read", "write", "create", "delete", "submit", "cancel", "amend")


def setup_provisioner_role(apply: bool) -> None:
    from frappe.permissions import add_permission, update_permission_property

    frappe.local.lang = "en"
    print(f"site={frappe.local.site} mode={'APPLY' if apply else 'DRY-RUN'}")
    print("REQUIRED_PERMISSIONS:")
    for doctype, rights in REQUIRED_PERMISSIONS.items():
        print(f"  {doctype}: {', '.join(rights)}")

    # Desk access on, like AMBURAX Integration: without it ERPNext makes the user a Website User,
    # which cannot use the REST API as a normal user.
    if not frappe.db.exists("Role", ROLE):
        print(f"  create Role {ROLE!r}")
        if apply:
            frappe.get_doc({"doctype": "Role", "role_name": ROLE, "desk_access": 1}).insert()
    elif not frappe.db.get_value("Role", ROLE, "desk_access"):
        print(f"  turn desk access on for {ROLE!r}")
        if apply:
            frappe.db.set_value("Role", ROLE, "desk_access", 1)

    for doctype, rights in REQUIRED_PERMISSIONS.items():
        current = frappe.db.get_value(
            "Custom DocPerm", {"parent": doctype, "role": ROLE, "permlevel": 0}, list(ALL_RIGHTS), as_dict=True
        )
        wanted = {r: int(r in rights) for r in ALL_RIGHTS}
        if current and all(int(current[r]) == wanted[r] for r in ALL_RIGHTS):
            print(f"  {doctype}: already {', '.join(rights)}")
            continue
        print(f"  {doctype}: set {', '.join(rights)} (submit, cancel, delete, amend off)")
        if apply:
            add_permission(doctype, ROLE, 0)
            for right, value in wanted.items():
                update_permission_property(doctype, ROLE, 0, right, value)

    if not frappe.db.exists("User", USER):
        print(f"  create User {USER!r} (System User, role {ROLE!r} only, no welcome email)")
        if apply:
            user = frappe.get_doc(
                {
                    "doctype": "User",
                    "email": USER,
                    "first_name": "AMBURAX Provisioner",
                    "user_type": "System User",
                    "send_welcome_email": 0,
                }
            )
            user.append("roles", {"role": ROLE})
            user.insert()
    else:
        if frappe.db.get_value("User", USER, "user_type") != "System User":
            print(f"  set {USER!r} to System User")
            if apply:
                frappe.db.set_value("User", USER, "user_type", "System User")
        user = frappe.get_doc("User", USER)
        # Only this role. ERPNext itself adds "Desk User" to every System User; that one stays.
        extra = [r.role for r in user.roles if r.role not in (ROLE, "Desk User")]
        if ROLE not in [r.role for r in user.roles]:
            print(f"  add role {ROLE!r} to {USER!r}")
        if extra:
            print(f"  remove other roles from {USER!r}: {', '.join(extra)}")
        if apply and (extra or ROLE not in [r.role for r in user.roles]):
            user.set("roles", [r for r in user.roles if r.role not in extra])
            if ROLE not in [r.role for r in user.roles]:
                user.append("roles", {"role": ROLE})
            user.save()

    if apply:
        frappe.db.commit()
        frappe.clear_cache()
        print("APPLIED")
    else:
        frappe.db.rollback()
        print("DRY-RUN: nothing changed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Set up the AMBURAX Provisioner role and user")
    parser.add_argument("site", help="ERPNext site name (required, no default)")
    parser.add_argument("--dry-run", action="store_true", help="print planned changes, change nothing")
    args = parser.parse_args()
    frappe.init(site=args.site, sites_path="/home/frappe/frappe-bench/sites")
    frappe.connect()
    try:
        setup_provisioner_role(apply=not args.dry_run)
    finally:
        frappe.destroy()
