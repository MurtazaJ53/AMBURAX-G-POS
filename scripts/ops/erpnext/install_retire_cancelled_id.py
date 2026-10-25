"""
Install (or update) the amburax_retire_cancelled_id Server Script on one ERPNext site.

Only sites in ALLOWED_SITES are accepted; production ("frontend") is deliberately absent until
the owner approves it there. The site must have server_script_enabled set.

  docker cp scripts/ops/erpnext/. frappe_docker-backend-1:/tmp/amburax_erpnext/
  docker exec -w /home/frappe/frappe-bench frappe_docker-backend-1 env/bin/python -c \
    "import frappe; frappe.init('scratch.local', sites_path='sites'); frappe.connect(); \
     import sys; sys.path.insert(0, '/tmp/amburax_erpnext'); \
     import install_retire_cancelled_id as i; i.run('/tmp/amburax_erpnext/amburax_retire_cancelled_id.py')"
"""

import frappe

ALLOWED_SITES = {"scratch.local"}
SCRIPT_NAME = "AMBURAX Retire Cancelled Id"
API_METHOD = "amburax_retire_cancelled_id"
BODY_MARKER = "# --- script body below this line"


def run(script_path):
    site = frappe.local.site
    if site not in ALLOWED_SITES:
        raise Exception("Refusing to install on site '%s'; allowed: %s" % (site, sorted(ALLOWED_SITES)))
    if not frappe.conf.get("server_script_enabled"):
        raise Exception("server_script_enabled is not set on site '%s'" % site)

    with open(script_path) as f:
        text = f.read()
    body = text.split(BODY_MARKER, 1)[1].split("\n", 1)[1]

    if frappe.db.exists("Server Script", SCRIPT_NAME):
        doc = frappe.get_doc("Server Script", SCRIPT_NAME)
        doc.script = body
        doc.disabled = 0
        doc.save(ignore_permissions=True)
        action = "updated"
    else:
        frappe.get_doc({
            "doctype": "Server Script",
            "name": SCRIPT_NAME,
            "__newname": SCRIPT_NAME,
            "script_type": "API",
            "api_method": API_METHOD,
            "allow_guest": 0,
            "script": body,
        }).insert(ignore_permissions=True)
        action = "installed"
    frappe.db.commit()
    print("%s %s on %s" % (action, SCRIPT_NAME, site))
