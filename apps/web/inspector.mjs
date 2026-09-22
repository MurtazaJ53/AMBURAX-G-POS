import fs from 'fs';
import path from 'path';

let wsPath = path.join(process.cwd(), 'apps/web/src/app/(app)/sales/_components/SalesWorkspace.tsx');
let wsContent = fs.readFileSync(wsPath, 'utf8');

const newInspector = `
        {/* Inspector Area (approx 300px fixed) */}
        <div className="w-full lg:w-[300px] shrink-0 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col h-full overflow-hidden relative">
          {activeTxRow ? (
            <>
              {/* Fixed Header */}
              <div className="px-4 py-3 border-b border-slate-200 shrink-0 bg-white z-10 flex justify-between items-center">
                <h2 className="text-[14.5px] font-bold text-slate-900 tracking-tight">Transaction Details</h2>
                <button className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
              </div>
              
              {/* Scrollable Content */}
              <div id="inspector-scroll" className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                
                {/* Transaction Meta */}
                <div className="flex justify-between items-start mb-1.5">
                  <span className="text-[16px] font-bold text-slate-900 leading-none">{txDetail?.billNumber || activeTxRow.billNumber}</span>
                  <span className={\`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider \${
                        activeTxRow.status === "COMPLETED" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"
                      }\`}>
                        {activeTxRow.status}
                  </span>
                </div>
                <div className="text-[11.5px] text-slate-500 mb-0.5 font-medium">
                  {activeTxRow.completedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, {activeTxRow.completedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="text-[11.5px] text-slate-500 mb-4 font-medium">Cashier: {txDetail?.cashierName || activeTxRow.cashierName}</div>
                
                {/* Customer Block */}
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5 flex items-center gap-2.5 mb-5">
                  <div className="w-7 h-7 rounded-md bg-white border border-slate-200 text-slate-400 flex items-center justify-center shrink-0">
                    <User size={14} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-bold text-slate-800 truncate">{txDetail?.customer?.name || activeTxRow.customerName || "Walk-in Customer"}</p>
                    {txDetail?.customer?.phone && <p className="text-[11px] text-slate-500">{txDetail.customer.phone}</p>}
                  </div>
                </div>

                {/* Items */}
                <div className="space-y-3 mb-5">
                  {txDetail ? (
                    txDetail.items.map(item => (
                      <div key={item.id} className="flex gap-2.5 items-start">
                        <div className="w-9 h-9 rounded bg-slate-50 border border-slate-100 shrink-0 flex items-center justify-center text-slate-300">
                          <Package size={16} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between items-start gap-2 mb-0.5">
                            <p className="text-[12px] font-medium text-slate-800 leading-snug truncate">{item.name}</p>
                            <span className="text-[12px] font-bold text-slate-900 shrink-0">{formatMinor(item.lineTotalMinor)}</span>
                          </div>
                          <p className="text-[11px] text-slate-500 font-medium">{formatMinor(item.unitPriceMinor)} × {item.quantity}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex justify-center p-4">
                      <div className="w-5 h-5 border-2 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-100 mb-4" />

                {/* Totals */}
                <div className="space-y-2 mb-5 text-[12px]">
                  <div className="flex justify-between text-slate-500 font-medium">
                    <span>Subtotal</span>
                    <span>{txDetail ? formatMinor(txDetail.subtotalMinor) : '—'}</span>
                  </div>
                  <div className="flex justify-between text-slate-500 font-medium">
                    <span>Discount</span>
                    <span>{txDetail && txDetail.discountMinor > 0 ? \`-\${formatMinor(txDetail.discountMinor)}\` : '—'}</span>
                  </div>
                  <div className="flex justify-between text-slate-500 font-medium">
                    <span>GST</span>
                    <span>{txDetail ? formatMinor(txDetail.taxMinor) : '—'}</span>
                  </div>
                  <div className="flex justify-between items-center pt-2.5 mt-2.5 border-t border-slate-100">
                    <span className="font-bold text-[13px] text-slate-800">Total</span>
                    <span className="font-bold text-[16px] text-slate-900">{formatMinor(activeTxRow.totalMinor)}</span>
                  </div>
                </div>

                <div className="border-t border-slate-100 mb-4" />

                {/* Payment Method */}
                <div className="mb-2">
                  <h3 className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider mb-2.5">Payment Method</h3>
                  {(txDetail?.payments || []).length > 0 ? (
                    txDetail!.payments.map((p, idx) => (
                      <div key={idx} className="flex items-center justify-between text-[12px] mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded bg-slate-100 flex items-center justify-center shrink-0 text-slate-500">
                            <CreditCard size={12} />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-700">{p.method}</p>
                            {p.reference && <p className="text-[10px] text-slate-400 font-medium mt-0.5">Ref: {p.reference}</p>}
                          </div>
                        </div>
                        <span className="font-semibold text-slate-900">{formatMinor(p.amountMinor)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded bg-slate-100 flex items-center justify-center shrink-0 text-slate-500">
                          <CreditCard size={12} />
                        </div>
                        <p className="font-semibold text-slate-700">{activeTxRow.paymentMethod || "Unknown"}</p>
                      </div>
                      <span className="font-semibold text-slate-900">{formatMinor(activeTxRow.totalMinor)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Sticky Actions */}
              <div className="p-3 border-t border-slate-200 shrink-0 bg-slate-50 flex gap-2">
                <button className="flex items-center justify-center h-[34px] flex-1 rounded-md border border-slate-200 text-[12px] font-semibold bg-white text-slate-700 hover:bg-slate-50 shadow-sm">
                  <Receipt size={14} className="mr-1.5" /> Print Bill
                </button>
                <button className="flex items-center justify-center h-[34px] flex-1 rounded-md border border-slate-200 text-[12px] font-semibold bg-slate-50 text-slate-400 cursor-not-allowed">
                  Return
                </button>
                <button className="flex items-center justify-center h-[34px] w-[34px] rounded-md border border-slate-200 shrink-0 text-slate-400 bg-white shadow-sm cursor-not-allowed">
                  <MoreHorizontal size={14} />
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <span className="text-[13px] font-medium">Select a transaction</span>
            </div>
          )}
        </div>
`;

// Extract everything from {/* Inspector Area to the end of that div
const inspectorRegex = /\{\/\*\s*Inspector Area\s*.*?\*\/\}.*?\{\/\*\s*ANALYTICS ROW\s*\*\/\}/s;

wsContent = wsContent.replace(
  inspectorRegex,
  newInspector + '\n      </div>\n\n      {/* ANALYTICS ROW */}'
);

// Add User, Package, CreditCard to imports
if (!wsContent.includes('User,')) {
  wsContent = wsContent.replace(/import \{([^}]+)\} from "lucide-react";/, 'import { $1, User, Package, CreditCard } from "lucide-react";');
}

fs.writeFileSync(wsPath, wsContent);
console.log("Rewrote Inspector UI");
