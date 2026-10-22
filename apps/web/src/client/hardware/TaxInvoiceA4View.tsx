"use client";

import { useMemo } from "react";
import { type ReceiptData } from "@/client/hardware/escpos";
import { amountInWords } from "@/client/hardware/amountInWords";
import { Building2, ShieldCheck, FileText } from "lucide-react";

/**
 * Statutory GST Tax Invoice (Rule 46 CGST Rules, 2017)
 *
 * Mandatory inclusions under Rule 46:
 * (a) Name, address and GSTIN of the supplier
 * (b) Consecutive serial number (billNumber) & Date of issue
 * (c) Name, address and GSTIN/Unique ID of recipient (if registered) or state/code for B2C
 * (d) HSN code of goods or Accounting Code of services
 * (e) Description of goods, quantity, unit, rate per item, total value
 * (f) Taxable value of goods taking into account discount
 * (g) Rate of tax (CGST, SGST, IGST) and tax amounts
 * (h) Place of supply along with the name of State and its code
 * (i) Total invoice amount in figures and words
 * (j) Signature or digital signature of the supplier or authorized representative
 */
export function TaxInvoiceA4View({ receiptData }: { receiptData: ReceiptData }) {
  const isInterState = receiptData.igstMinor && receiptData.igstMinor > 0;

  // Aggregate HSN / Tax Breakdown
  const taxBreakdown = useMemo(() => {
    type HsnSummary = {
      hsn: string;
      taxableMinor: number;
      rateBp: number;
      cgstMinor: number;
      sgstMinor: number;
      igstMinor: number;
      totalTaxMinor: number;
    };

    const map = new Map<string, HsnSummary>();

    receiptData.items.forEach((item) => {
      const hsn = item.hsn || "6203"; // Default readymade garments HSN code
      const rateBp = item.gstRateBp || 500;
      const key = `${hsn}-${rateBp}`;

      // Extract taxable from line total (assuming tax-inclusive retail MRP)
      const lineTaxableMinor = Math.round((item.totalMinor * 10000) / (10000 + rateBp));
      const lineTaxMinor = item.totalMinor - lineTaxableMinor;
      const halfTax = Math.round(lineTaxMinor / 2);

      const existing = map.get(key) || {
        hsn,
        taxableMinor: 0,
        rateBp,
        cgstMinor: 0,
        sgstMinor: 0,
        igstMinor: 0,
        totalTaxMinor: 0,
      };

      existing.taxableMinor += lineTaxableMinor;
      if (isInterState) {
        existing.igstMinor += lineTaxMinor;
      } else {
        existing.cgstMinor += halfTax;
        existing.sgstMinor += lineTaxMinor - halfTax;
      }
      existing.totalTaxMinor += lineTaxMinor;

      map.set(key, existing);
    });

    return Array.from(map.values());
  }, [receiptData.items, isInterState]);

  const totalTaxableMinor = taxBreakdown.reduce((sum, row) => sum + row.taxableMinor, 0);
  const totalCgstMinor = taxBreakdown.reduce((sum, row) => sum + row.cgstMinor, 0);
  const totalSgstMinor = taxBreakdown.reduce((sum, row) => sum + row.sgstMinor, 0);
  const totalIgstMinor = taxBreakdown.reduce((sum, row) => sum + row.igstMinor, 0);
  const totalTaxMinor = taxBreakdown.reduce((sum, row) => sum + row.totalTaxMinor, 0);

  const formattedDate = new Date(receiptData.date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const formattedTime = new Date(receiptData.date).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="w-full bg-white p-6 sm:p-8 font-sans text-slate-800 text-[11px] leading-normal border border-slate-300 rounded-lg shadow-sm print:shadow-none print:border-none print:p-0 print:w-full">
      {/* Title & Statutory Heading */}
      <div className="text-center pb-3 border-b-2 border-slate-900">
        <span className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">
          FORM GST INV-1 (RULE 46)
        </span>
        <h1 className="text-xl font-black uppercase tracking-wider text-slate-900">
          TAX INVOICE
        </h1>
        <p className="text-[10px] font-semibold text-slate-500">
          (Original for Recipient / Duplicate for Supplier)
        </p>
      </div>

      {/* Supplier & Invoice Header Grid */}
      <div className="grid grid-cols-2 gap-4 py-3 border-b border-slate-300 text-xs">
        {/* Supplier Details */}
        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase text-slate-400">Details of Supplier</div>
          <div className="text-sm font-bold text-slate-900">{receiptData.storeName}</div>
          <div className="text-slate-600 text-[11px] leading-tight">
            {receiptData.storeAddress || "Retail Store Address"}
          </div>
          <div className="pt-1 text-[11px]">
            <span className="font-semibold text-slate-700">GSTIN: </span>
            <span className="font-mono font-bold text-slate-900">
              {receiptData.storeGstin || "29AABCU9603R1ZM (Registered)"}
            </span>
          </div>
          <div className="text-[11px]">
            <span className="font-semibold text-slate-700">State / Code: </span>
            <span>{receiptData.storeState || "Karnataka"} (Code: {receiptData.storeStateCode || "29"})</span>
          </div>
        </div>

        {/* Invoice Metadata */}
        <div className="space-y-1 text-right">
          <div className="text-[10px] font-bold uppercase text-slate-400">Invoice Credentials</div>
          <div>
            <span className="font-semibold text-slate-700">Invoice No: </span>
            <span className="font-mono font-bold text-slate-900">{receiptData.billNumber}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-700">Invoice Date: </span>
            <span>{formattedDate} {formattedTime}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-700">POS Terminal: </span>
            <span>{receiptData.terminalName || "Counter POS-01"}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-700">Cashier: </span>
            <span>{receiptData.cashierName}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-700">Place of Supply: </span>
            <span className="font-semibold text-slate-900">{receiptData.placeOfSupply || receiptData.storeState || "Karnataka (29)"}</span>
          </div>
        </div>
      </div>

      {/* Recipient Details */}
      <div className="py-2.5 px-3 my-3 bg-slate-50 border border-slate-200 rounded flex flex-wrap justify-between items-center text-xs">
        <div>
          <span className="text-[10px] font-bold uppercase text-slate-400 block">Billed To (Recipient):</span>
          <span className="font-bold text-slate-900">
            {receiptData.customerName || "Unregistered Retail Counter Customer"}
          </span>
          {receiptData.customerPhone && (
            <span className="text-slate-500 ml-2">({receiptData.customerPhone})</span>
          )}
        </div>
        <div className="text-right">
          <span className="text-[10px] font-bold uppercase text-slate-400 block">Recipient GSTIN / UIN:</span>
          <span className="font-mono font-semibold text-slate-800">
            {receiptData.customerGstin ? (
              <span className="text-emerald-700 font-bold">{receiptData.customerGstin} (B2B Tax Invoice)</span>
            ) : (
              "URP (Consumer / B2C Retail)"
            )}
          </span>
        </div>
      </div>

      {/* Itemized Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse border border-slate-300 text-[10px]">
          <thead>
            <tr className="bg-slate-100 text-slate-800 uppercase font-bold border-b border-slate-300">
              <th className="py-2 px-1.5 border-r border-slate-300 w-8 text-center">#</th>
              <th className="py-2 px-2 border-r border-slate-300">Description of Goods</th>
              <th className="py-2 px-2 border-r border-slate-300 w-16 text-center">HSN</th>
              <th className="py-2 px-2 border-r border-slate-300 w-12 text-center">Qty</th>
              <th className="py-2 px-2 border-r border-slate-300 w-16 text-right">Unit Rate</th>
              <th className="py-2 px-2 border-r border-slate-300 w-20 text-right">Taxable Val</th>
              <th className="py-2 px-2 border-r border-slate-300 w-16 text-center">GST %</th>
              <th className="py-2 px-2 border-slate-300 w-20 text-right">Amount (₹)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {receiptData.items.map((item, idx) => {
              const rateBp = item.gstRateBp || 500;
              const taxable = Math.round((item.totalMinor * 10000) / (10000 + rateBp));
              return (
                <tr key={idx} className="hover:bg-slate-50/50">
                  <td className="py-1.5 px-1.5 border-r border-slate-200 text-center font-mono text-slate-500">
                    {idx + 1}
                  </td>
                  <td className="py-1.5 px-2 border-r border-slate-200">
                    <div className="font-semibold text-slate-900">{item.name}</div>
                    {item.variant && (
                      <div className="text-[9px] text-slate-500">{item.variant}</div>
                    )}
                    {item.sku && (
                      <div className="text-[9px] text-slate-400 font-mono">SKU: {item.sku}</div>
                    )}
                  </td>
                  <td className="py-1.5 px-2 border-r border-slate-200 text-center font-mono text-slate-600">
                    {item.hsn || "6203"}
                  </td>
                  <td className="py-1.5 px-2 border-r border-slate-200 text-center font-semibold">
                    {item.quantity}
                  </td>
                  <td className="py-1.5 px-2 border-r border-slate-200 text-right font-mono">
                    ₹{(item.unitPriceMinor / 100).toFixed(2)}
                  </td>
                  <td className="py-1.5 px-2 border-r border-slate-200 text-right font-mono">
                    ₹{(taxable / 100).toFixed(2)}
                  </td>
                  <td className="py-1.5 px-2 border-r border-slate-200 text-center font-semibold text-slate-700">
                    {(rateBp / 100).toFixed(1)}%
                  </td>
                  <td className="py-1.5 px-2 border-slate-200 text-right font-mono font-bold text-slate-900">
                    ₹{(item.totalMinor / 100).toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-bold border-t-2 border-slate-300">
              <td colSpan={3} className="py-2 px-2 border-r border-slate-300 text-right uppercase">
                Total Units &amp; Subtotal:
              </td>
              <td className="py-2 px-2 border-r border-slate-300 text-center">
                {receiptData.items.reduce((acc, i) => acc + i.quantity, 0)}
              </td>
              <td className="py-2 px-2 border-r border-slate-300"></td>
              <td className="py-2 px-2 border-r border-slate-300 text-right font-mono">
                ₹{(totalTaxableMinor / 100).toFixed(2)}
              </td>
              <td className="py-2 px-2 border-r border-slate-300"></td>
              <td className="py-2 px-2 text-right font-mono text-slate-900">
                ₹{(receiptData.totalMinor / 100).toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Statutory HSN / Tax Summary Table (Mandatory under Rule 46) */}
      <div className="mt-4">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
          Statutory HSN / SAC Tax Summary
        </div>
        <table className="w-full text-left border-collapse border border-slate-300 text-[10px]">
          <thead>
            <tr className="bg-slate-100 font-bold border-b border-slate-300 text-slate-800">
              <th className="py-1.5 px-2 border-r border-slate-300 text-center">HSN/SAC</th>
              <th className="py-1.5 px-2 border-r border-slate-300 text-right">Taxable Value</th>
              {!isInterState ? (
                <>
                  <th className="py-1.5 px-2 border-r border-slate-300 text-center" colSpan={2}>CGST</th>
                  <th className="py-1.5 px-2 border-r border-slate-300 text-center" colSpan={2}>SGST</th>
                </>
              ) : (
                <th className="py-1.5 px-2 border-r border-slate-300 text-center" colSpan={2}>IGST</th>
              )}
              <th className="py-1.5 px-2 text-right">Total Tax (₹)</th>
            </tr>
            {!isInterState ? (
              <tr className="bg-slate-50 text-[9px] font-semibold border-b border-slate-300 text-slate-600">
                <th className="border-r border-slate-300"></th>
                <th className="border-r border-slate-300"></th>
                <th className="py-1 px-1.5 border-r border-slate-300 text-center w-12">Rate</th>
                <th className="py-1 px-2 border-r border-slate-300 text-right w-16">Amount</th>
                <th className="py-1 px-1.5 border-r border-slate-300 text-center w-12">Rate</th>
                <th className="py-1 px-2 border-r border-slate-300 text-right w-16">Amount</th>
                <th></th>
              </tr>
            ) : (
              <tr className="bg-slate-50 text-[9px] font-semibold border-b border-slate-300 text-slate-600">
                <th className="border-r border-slate-300"></th>
                <th className="border-r border-slate-300"></th>
                <th className="py-1 px-1.5 border-r border-slate-300 text-center w-12">Rate</th>
                <th className="py-1 px-2 border-r border-slate-300 text-right w-16">Amount</th>
                <th></th>
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-slate-200">
            {taxBreakdown.map((row, idx) => (
              <tr key={idx} className="font-mono">
                <td className="py-1.5 px-2 border-r border-slate-200 text-center text-slate-700">
                  {row.hsn}
                </td>
                <td className="py-1.5 px-2 border-r border-slate-200 text-right text-slate-900">
                  ₹{(row.taxableMinor / 100).toFixed(2)}
                </td>
                {!isInterState ? (
                  <>
                    <td className="py-1.5 px-1.5 border-r border-slate-200 text-center text-slate-600">
                      {(row.rateBp / 200).toFixed(1)}%
                    </td>
                    <td className="py-1.5 px-2 border-r border-slate-200 text-right text-slate-900">
                      ₹{(row.cgstMinor / 100).toFixed(2)}
                    </td>
                    <td className="py-1.5 px-1.5 border-r border-slate-200 text-center text-slate-600">
                      {(row.rateBp / 200).toFixed(1)}%
                    </td>
                    <td className="py-1.5 px-2 border-r border-slate-200 text-right text-slate-900">
                      ₹{(row.sgstMinor / 100).toFixed(2)}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-1.5 px-1.5 border-r border-slate-200 text-center text-slate-600">
                      {(row.rateBp / 100).toFixed(1)}%
                    </td>
                    <td className="py-1.5 px-2 border-r border-slate-200 text-right text-slate-900">
                      ₹{(row.igstMinor / 100).toFixed(2)}
                    </td>
                  </>
                )}
                <td className="py-1.5 px-2 text-right font-bold text-slate-900">
                  ₹{(row.totalTaxMinor / 100).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold font-mono border-t border-slate-300">
              <td className="py-1.5 px-2 border-r border-slate-300 text-center uppercase font-sans">Total:</td>
              <td className="py-1.5 px-2 border-r border-slate-300 text-right">
                ₹{(totalTaxableMinor / 100).toFixed(2)}
              </td>
              {!isInterState ? (
                <>
                  <td className="py-1.5 px-1.5 border-r border-slate-300"></td>
                  <td className="py-1.5 px-2 border-r border-slate-300 text-right">
                    ₹{(totalCgstMinor / 100).toFixed(2)}
                  </td>
                  <td className="py-1.5 px-1.5 border-r border-slate-300"></td>
                  <td className="py-1.5 px-2 border-r border-slate-300 text-right">
                    ₹{(totalSgstMinor / 100).toFixed(2)}
                  </td>
                </>
              ) : (
                <>
                  <td className="py-1.5 px-1.5 border-r border-slate-300"></td>
                  <td className="py-1.5 px-2 border-r border-slate-300 text-right">
                    ₹{(totalIgstMinor / 100).toFixed(2)}
                  </td>
                </>
              )}
              <td className="py-1.5 px-2 text-right font-bold">
                ₹{(totalTaxMinor / 100).toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Invoice Words & Grand Total Block */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-3 border-t-2 border-slate-900">
        <div className="space-y-2">
          <div>
            <span className="text-[10px] font-bold uppercase text-slate-400 block">Total Amount in Words:</span>
            <span className="text-xs font-semibold text-slate-900 italic">
              {amountInWords(receiptData.totalMinor)}
            </span>
          </div>

          {receiptData.payments.length > 0 && (
            <div className="text-[10px] pt-1">
              <span className="font-bold uppercase text-slate-400 block">Settlement Details:</span>
              <div className="space-y-0.5 mt-0.5">
                {receiptData.payments.map((p, idx) => (
                  <div key={idx} className="flex justify-between max-w-xs text-slate-700">
                    <span>{p.method} {p.reference ? `(${p.reference})` : ""}:</span>
                    <span className="font-mono font-semibold">₹{(p.amountMinor / 100).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-[9px] text-slate-500 pt-2 space-y-0.5">
            <p className="font-semibold text-slate-700">Terms &amp; Conditions:</p>
            <p>1. Goods once sold can be exchanged within 7 days against original invoice.</p>
            <p>2. Certified that all the particulars shown in this invoice are true and correct.</p>
          </div>
        </div>

        {/* Grand Total Summary & Signature */}
        <div className="flex flex-col justify-between items-end text-right">
          <div className="w-full max-w-xs space-y-1 text-xs">
            <div className="flex justify-between py-0.5 border-b border-slate-100 text-slate-600">
              <span>Gross Taxable Amount:</span>
              <span className="font-mono">₹{(totalTaxableMinor / 100).toFixed(2)}</span>
            </div>
            {receiptData.discountMinor && receiptData.discountMinor > 0 ? (
              <div className="flex justify-between py-0.5 border-b border-slate-100 text-emerald-700">
                <span>Discount / Concession:</span>
                <span className="font-mono">-₹{(receiptData.discountMinor / 100).toFixed(2)}</span>
              </div>
            ) : null}
            <div className="flex justify-between py-0.5 border-b border-slate-100 text-slate-600">
              <span>Total GST Charged:</span>
              <span className="font-mono">₹{(totalTaxMinor / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-t-2 border-b-2 border-slate-900 text-sm font-black text-slate-900 bg-slate-50 px-2 rounded">
              <span>INVOICE TOTAL:</span>
              <span className="font-mono">₹{(receiptData.totalMinor / 100).toFixed(2)}</span>
            </div>
          </div>

          <div className="mt-8 text-center pt-2">
            <div className="h-10"></div>
            <div className="border-t border-slate-400 w-48 text-[10px] font-bold text-slate-700 pt-1">
              For {receiptData.storeName}
            </div>
            <div className="text-[9px] text-slate-400 uppercase tracking-wider">
              Authorized Signatory
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
