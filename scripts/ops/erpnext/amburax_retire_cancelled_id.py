# ERPNext Server Script — Script Type: API, API Method: amburax_retire_cancelled_id
#
# Why: `Sales Invoice.amburax_sale_id` is unique and stays unique. A cancelled invoice keeps its
# row for the GST audit trail, so before AMBURAX re-syncs that sale it moves the cancelled invoice
# out of the way by renaming its tracking id to "<id>-CANCELLED-<n>". Frappe refuses REST edits
# to a cancelled document, so the rename runs here, server-side.
#
# For production, move this into a custom Frappe app instead of a Server Script: a Server
# Script needs server_script_enabled on the site, lives only in the database, and has no review
# or version history. Until then it is installed on scratch.local only.
#
# Returns use the same field: a return is a Sales Invoice (is_return) and carries the return's id
# in amburax_sale_id, so the one allow-listed field covers sales and returns.
#
# Rules this script enforces:
#   1. Only a cancelled document (docstatus 2) is changed; anything else is refused.
#   2. Only the allow-listed amburax_* tracking field changes, and only to
#      "<base_id>-CANCELLED-<n>" (n a positive whole number not used by another document).
#      Nothing else on the document changes; `modified` is left as it was.
#   3. Only users with the "AMBURAX Integration" role may call it.
#   4. Every rename adds an Info comment on the document with the old and new value.
#   5. Calling it again for a document already renamed is a no-op.
#
# Install with scripts/ops/erpnext/install_retire_cancelled_id.py (needs server_script_enabled
# on the site). Called as POST /api/method/amburax_retire_cancelled_id with
#   doctype, name, fieldname, base_id, value
# It returns nothing; the caller re-reads the document. (The Server Script sandbox does not
# expose frappe.response, so a script cannot set a return value there.)
# --- script body below this line is what the installer stores in the Server Script ---

ALLOWED_FIELDS = {"Sales Invoice": "amburax_sale_id"}
REQUIRED_ROLE = "AMBURAX Integration"

if not frappe.db.exists("Has Role", {"parent": frappe.session.user, "parenttype": "User", "role": REQUIRED_ROLE}):
    frappe.throw("Not permitted: requires the " + REQUIRED_ROLE + " role", frappe.PermissionError)

doctype = frappe.form_dict.get("doctype")
name = frappe.form_dict.get("name")
fieldname = frappe.form_dict.get("fieldname")
base_id = frappe.form_dict.get("base_id")
value = frappe.form_dict.get("value")

if ALLOWED_FIELDS.get(doctype) != fieldname:
    frappe.throw("Field not allowed")
prefix = (base_id or "") + "-CANCELLED-"
if not base_id or not value or not value.startswith(prefix):
    frappe.throw("Value must be <base_id>-CANCELLED-<n>")
suffix = value[len(prefix):]
if not suffix.isdigit() or int(suffix) < 1:
    frappe.throw("n must be a positive whole number")

doc = frappe.db.get_value(doctype, name, ["docstatus", fieldname], as_dict=True)
if not doc:
    frappe.throw("Document not found")
if doc.docstatus != 2:
    frappe.throw("Only a cancelled document can be renamed (docstatus is " + str(doc.docstatus) + ")")

current = doc.get(fieldname)
if current and current.startswith(prefix):
    # Already renamed by an earlier call: nothing to do.
    pass
elif current != base_id:
    frappe.throw("Document does not carry this id")
elif frappe.db.exists(doctype, {fieldname: value}):
    frappe.throw("That id is already used")
else:
    frappe.db.set_value(doctype, name, fieldname, value, update_modified=False)
    frappe.get_doc({
        "doctype": "Comment",
        "comment_type": "Info",
        "reference_doctype": doctype,
        "reference_name": name,
        "content": "AMBURAX: " + fieldname + " changed from " + base_id + " to " + value
        + " so the sale can be synced again. Requested by " + frappe.session.user + ".",
    }).insert(ignore_permissions=True)
