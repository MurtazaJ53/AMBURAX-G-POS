# GST Taxation & Statutory Audit Compliance

| Document ID | AMB-SEC-002 | Version | 1.0.0 |
| :--- | :--- | :--- | :--- |
| **System** | AMBURAX G-POS | Status | Approved |
| **Date** | 2026-10-19 | Authors | Legal Compliance & Tax Engineering |

---

## 1. Indian GST Statutory Invoicing Rules

AMBURAX G-POS complies fully with the Central Goods and Services Tax (CGST) Act, 2017:

1. **Consecutive Serial Numbering**:
   - Bill numbers follow a consecutive sequence (`STR-000142`) without gaps.
   - Separate sequences are maintained per fiscal year and store location.
2. **Dual-Slab Garment Tax Logic**:
   - For apparel retail, the system implements dual GST tax slabs:
     - Taxable value $\le \text{₹1,000.00}$: Taxed at **5% GST** (2.5% CGST + 2.5% SGST).
     - Taxable value $> \text{₹1,000.00}$: Taxed at **12% GST** (6.0% CGST + 6.0% SGST).
   - Interstate transactions automatically apply **IGST** at 5% or 12%.
3. **HSN / SAC Code Enforcement**:
   - Every product variant stores an authoritative 4, 6, or 8-digit HSN code printed on statutory B2B invoices.

---

## 2. Tax Computation Invariants

$$\text{Taxable Value} = \text{Item Gross Price} - \text{Proportional Discount}$$

$$\text{CGST} = \text{Round}\left(\frac{\text{Taxable Value} \times \text{CGST Rate Bp}}{10,000}\right)$$

$$\text{SGST} = \text{Round}\left(\frac{\text{Taxable Value} \times \text{SGST Rate Bp}}{10,000}\right)$$

- **Basis Points Precision**: Tax rates are stored in basis points (`500` bp = 5.00%, `1200` bp = 12.00%) to eliminate floating point imprecision.
- **Audit Trails**: In accordance with statutory audit regulations, completed sales invoices are immutable; amendments are performed strictly through debit/credit notes.
