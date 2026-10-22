# Troubleshooting and Incident Response SOP

| Document ID | AMB-SOP-003 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | IT Support & Counter Operations Lead |

---

## 1. Common Counter Errors & Instant Resolutions

| Error Prompt / Issue | Root Cause | Immediate Action / Resolution |
| :--- | :--- | :--- |
| **"At least one payment is required."** | Tender mismatch or zero tender on non-Udhar method. | Select `UDHAR` method for on-account sales, or enter cash/UPI amount tendered. Ensure promotion discount matches net total. |
| **"Verify customer's phone before giving udhar."** | Customer has not completed mobile OTP verification. | Press `F3`, open Customer Details, click "Send OTP", and enter the 6-digit code received on customer's phone. |
| **"This customer has no udhar limit set."** | Credit mode is set to LIMITED with limit ₹0. | Store Manager or Accountant must set an authorized credit limit under the Khata customer profile. |
| **"Barcode not found: nothing matches..."** | Item has not been registered in catalog or barcode tag damaged. | Press `F1` to search by product name/size, or register barcode in Catalog Management. |
| **"Only N available; remainder reserved..."** | Another active till or pending order has reserved stock units. | Complete or cancel the pending cart on the other till, or replenish stock via Inventory Adjustments. |
| **Receipt printer does not cut paper.** | ESC/POS cutter command not enabled or paper jam. | Open printer cover, reseat 80mm thermal paper roll, ensure paper feeds straight, and press Feed. |

---

## 2. Emergency Incident Escalation Matrix

If a counter issue cannot be resolved within 5 minutes:

1. **Level 1 (Store Shift Supervisor)**:
   - Restart the local browser tab (`F5` or `Ctrl+F5`).
   - Check local router connection (verify ping to server gateway).
2. **Level 2 (Regional IT Support)**:
   - Verify Node.js process and PostgreSQL database status via PM2.
   - Inspect application server logs: `tail -f /var/log/gpos/error.log`.
3. **Level 3 (Core Engineering Hotfix Team)**:
   - On-call engineer mobilizes within 15 minutes for any P1 issue affecting active checkout counters.
