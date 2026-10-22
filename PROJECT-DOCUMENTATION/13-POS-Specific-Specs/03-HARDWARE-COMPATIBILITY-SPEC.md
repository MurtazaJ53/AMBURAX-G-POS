# Hardware Compatibility & Peripheral Integration Specification

| Document ID | AMB-POS-003 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Retail Hardware & IoT Engineering |

---

## 1. Supported Counter Hardware Peripherals

AMBURAX G-POS interfaces seamlessly with standard commercial retail hardware:

```text
+------------------------------------------------------------------+
|                     Counter POS Terminal PC                      |
+------------------------------------------------------------------+
      | (USB HID)               | (USB / Network / Bluetooth)
      v                         v
+-----------------------+  +---------------------------------------+
| Barcode / QR Scanner  |  | 80mm / 58mm Thermal Receipt Printer   |
| (Honeywell, Zebra)    |  | (Epson TM-T82, TVS, NGX, Star Micronics)
+-----------------------+  +---------------------------------------+
                                | (RJ11 Cable Kick Pulse)
                                v
                           +---------------------------------------+
                           | Heavy Duty Steel Cash Drawer          |
                           | (APG, Posiflex, TVS Cash Drawer)      |
                           +---------------------------------------+
```

---

## 2. Peripheral Communication Protocols

### 2.1 Thermal Receipt Printers (ESC/POS)
- **Supported Formats**: 80mm standard (48 columns) and 58mm compact (32 columns).
- **Driverless Web Printing**:
  - Direct WebUSB or Raw Socket printing using standard ESC/POS command sequences:
    - Initialize Printer: `ESC @` (`\x1B\x40`)
    - Center Text: `ESC a 1` (`\x1B\x61\x01`)
    - Bold On/Off: `ESC E 1` / `ESC E 0`
    - Paper Cut: `GS V 66 0` (`\x1D\x56\x42\x00`)

### 2.2 USB & Wireless Barcode Scanners
- Operates in standard **USB Keyboard Wedge (HID)** mode.
- Supports UPC-A, EAN-13, EAN-8, Code 128, QR Code, and Data Matrix symbologies.
- Emits trailing carriage return (`Enter`) to automatically submit scans without operator intervention.

### 2.3 Electronic Cash Drawers (RJ11)
- Connected directly via the thermal printer's RJ11 peripheral port.
- Solenoid pulse triggered automatically on successful cash bill completion or via manager `F11` key:
  `ESC p 0 25 250` (`\x1B\x70\x00\x19\xFA`).
