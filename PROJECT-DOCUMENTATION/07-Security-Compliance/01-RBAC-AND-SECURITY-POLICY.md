# Role-Based Access Control (RBAC) & Security Policy

| Document ID | AMB-SEC-001 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Chief Information Security Officer (CISO) & Security Architecture |

---

## 1. Role-Based Access Control (RBAC) Matrix

| Action / Capability | Cashier | Floor Staff | Store Manager | Accountant | Tenant Owner |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Ring Sales (Cash/Card/UPI)** | Allowed | Denied | Allowed | Denied | Allowed |
| **Ring Sales on Udhar (Credit)** | Allowed | Denied | Allowed | Denied | Allowed |
| **Small Discount (<= 10%)** | Self (Reason)| Denied | Self | Denied | Self |
| **Large Discount (> 10%)** | PIN Approval | Denied | PIN Approval | Denied | Self |
| **Start / Stop Store Offers** | Allowed | Denied | Allowed | Denied | Allowed |
| **Create New Offer Rules** | Denied | Denied | Allowed | Denied | Allowed |
| **Open / Close Shift Drawer** | Allowed | Denied | Allowed | Denied | Allowed |
| **Adjust Stock / Write-off** | Denied | Denied | Allowed | Denied | Allowed |
| **View Profit & Gross Margin** | Denied | Denied | Allowed | Allowed | Allowed |
| **Edit Customer Credit Limits** | Denied | Denied | Denied | Allowed | Allowed |
| **Company & Store Config** | Denied | Denied | Denied | Denied | Allowed |

---

## 2. Authentication & Session Management

1. **Iron-Session Crypto**: Session cookies are encrypted using AES-256-GCM and signed with HMAC-SHA256. Secret keys are never exposed in client bundles.
2. **Brute Force Protection & PIN Lockout**:
   - Manager discount approval PINs allow up to 3 incorrect attempts.
   - On the 4th failed attempt, the approver's PIN is locked for 15 minutes, and an audit warning is generated.
3. **Session Expiry**: Inactive counter sessions expire after 12 hours of inactivity to prevent unauthorized access on unattended terminals.
