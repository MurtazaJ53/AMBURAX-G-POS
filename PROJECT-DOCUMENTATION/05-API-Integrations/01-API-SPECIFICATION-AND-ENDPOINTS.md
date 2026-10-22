# API Specification and Endpoints Reference

| Document ID | AMB-API-001 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Backend API Engineering Team |

---

## 1. Authentication & Base Headers

All API endpoints reside under `/api/v1/`.

- **Authentication**: Session cookie (`gpos_session`) signed via iron-session with HMAC-SHA256.
- **Content-Type**: `application/json`
- **Standard Error Response Format**:
  ```json
  {
    "ok": false,
    "error": {
      "code": "validation_error",
      "message": "Enter a valid udhar amount."
    }
  }
  ```

---

## 2. Core API Endpoints

### 2.1 Complete Sale Checkout
- **Endpoint**: `POST /api/v1/sales`
- **Description**: Creates and finalizes a counter sale, commits stock movements, and records tenders.
- **Request Payload**:
  ```json
  {
    "idempotencyKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "lines": [
      { "variantId": "var_90218", "quantity": 2 }
    ],
    "customerId": "cust_38192",
    "discountMinor": 30000,
    "discountReason": "Festival Offer",
    "onAccountMinor": 370000,
    "payment": {
      "method": "CASH",
      "amountMinor": 100000
    }
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "ok": true,
    "sale": {
      "id": "sale_71829",
      "billNumber": "STR-000142",
      "totalMinor": 470000,
      "paidMinor": 100000,
      "dueMinor": 370000,
      "paymentStatus": "PARTIALLY_PAID",
      "erpSyncStatus": "PENDING",
      "completedAt": "2026-10-19T05:30:00.000Z"
    },
    "duplicate": false
  }
  ```

### 2.2 Barcode Exact Lookup
- **Endpoint**: `GET /api/v1/pos/scan?barcode={barcode}`
- **Response**: `200 OK`
  ```json
  {
    "kind": "found",
    "item": {
      "variantId": "var_90218",
      "productName": "Men Slim Fit Denim Jeans",
      "sku": "DNM-SLIM-32",
      "barcode": "8901234567890",
      "size": "32",
      "colour": "Indigo Blue",
      "priceMinor": 199900,
      "taxRateBp": 1200,
      "taxRateMode": "EXCLUSIVE",
      "taxTreatment": "STANDARD",
      "stockQuantity": 14
    }
  }
  ```

### 2.3 Promotions Management
- **Endpoint**: `GET /api/v1/promotions` (List all active promotions)
- **Endpoint**: `POST /api/v1/promotions` (Create new promotion)
- **Endpoint**: `PATCH /api/v1/promotions/{id}/status` (Toggle active / paused)
  ```json
  {
    "isActive": true
  }
  ```

### 2.4 Customer Khata & OTP Verification
- **Endpoint**: `POST /api/v1/customers/{id}/otp/send` (Send 6-digit SMS OTP)
- **Endpoint**: `POST /api/v1/customers/{id}/otp/verify` (Verify code e.g. `218590`)
- **Endpoint**: `GET /api/v1/khata/customers/{id}` (Get authoritative ledger balance)
