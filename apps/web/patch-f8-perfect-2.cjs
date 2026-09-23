const fs = require('fs');
const file = 'src/app/(app)/pos/PosTerminal.tsx';
let code = fs.readFileSync(file, 'utf8');

const startMarker = '{/* Checkout Footer (Fixed) */}';
const endMarker = 'function ActionBtn';

const startIndex = code.indexOf(startMarker);
const endIndex = code.indexOf(endMarker);

const replacement = `{/* Checkout Footer (Fixed) */}
        <div className="bg-white border-t border-slate-200 p-2 flex flex-col shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.03)] z-20">
           
           {/* Discount */}
           <div className="flex gap-2">
             <input disabled placeholder="Add Discount" className="flex-1 text-[12px] border border-slate-200 rounded-[6px] px-2.5 h-[34px] bg-slate-50 text-slate-500 outline-none" />
             <div className="flex border border-slate-200 rounded-[6px] overflow-hidden bg-white">
               <button disabled className="px-2.5 h-[34px] border-r border-slate-200 text-[12px] font-medium text-slate-600 bg-slate-50">%</button>
               <button disabled className="px-2.5 h-[34px] text-[12px] font-bold text-slate-700 bg-white">₹</button>
             </div>
             <button disabled className="px-4 h-[34px] bg-slate-100 border border-slate-200 rounded-[6px] text-[12px] font-semibold text-slate-400">Apply</button>
           </div>
           
           <div className="h-px bg-slate-100 w-full my-1.5"></div>

           {/* Totals */}
           <div className="flex flex-col text-[12px]">
              <div className="flex justify-between items-center h-[24px] text-slate-600">
                <span>Items ({cart.reduce((a,b)=>a+b.quantity,0)})</span>
                <span className="font-semibold text-slate-900">{formatMinor(totals.subtotalMinor)}</span>
              </div>
              <div className="flex justify-between items-center h-[24px] text-slate-600">
                <span>Discount</span>
                <span className="text-slate-400">—</span>
              </div>
              <div className="flex justify-between items-center h-[24px] text-slate-600">
                <span>Subtotal</span>
                <span className="text-slate-400">—</span>
              </div>
              <div className="flex justify-between items-center h-[24px] text-slate-600">
                <span>GST / Tax</span>
                <span className="text-slate-400">—</span>
              </div>
              
              <div className="flex justify-between items-center h-[30px] border-t border-slate-100 mt-1 pt-1">
                <span className="text-[16px] font-bold text-slate-900">Total Amount</span>
                <span className="text-[18px] font-bold text-blue-700">{formatMinor(totals.totalMinor)}</span>
              </div>
           </div>

           <div className="h-px bg-slate-100 w-full my-2"></div>

           {/* Payment Modes */}
           <div>
             <div className="flex gap-1.5 h-[34px]">
               {PAYMENT_METHODS.map(m => (
                 <button 
                   key={m.value}
                   onClick={() => setMethod(m.value)}
                   className={\`flex-1 text-[11px] font-bold rounded-[6px] border transition-colors \${method === m.value ? 'bg-[#10b981] border-[#10b981] text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}\`}
                 >
                   {m.label}
                 </button>
               ))}
             </div>
           </div>

           {/* Cash Amount Received */}
           {method === 'CASH' && (
             <div className="flex flex-col mt-2">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-[12px] font-semibold text-slate-600">Amount Received</span>
                  <input 
                    type="number"
                    value={amountReceived ?? ''}
                    onChange={(e) => setAmountReceived(e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder={formatMinor(totals.totalMinor)}
                    className="w-28 text-right text-[13px] font-bold border border-slate-200 rounded-[6px] px-2 h-[34px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="flex gap-1 h-[30px] mb-1.5">
                  <button onClick={() => setAmountReceived((totals.totalMinor/100) + 1)} className="flex-1 text-[11px] border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 rounded-[6px] font-semibold">+1</button>
                  <button onClick={() => setAmountReceived((totals.totalMinor/100) + 10)} className="flex-1 text-[11px] border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 rounded-[6px] font-semibold">+10</button>
                  <button onClick={() => setAmountReceived((totals.totalMinor/100) + 100)} className="flex-1 text-[11px] border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 rounded-[6px] font-semibold">+100</button>
                  <button onClick={() => setAmountReceived(totals.totalMinor/100)} className="flex-[1.2] text-[11px] border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-[6px] font-bold">Exact</button>
                </div>
                <div className="flex justify-between items-center text-[13px] h-[26px]">
                  <span className="font-semibold text-slate-500">Balance</span>
                  <span className="font-bold text-slate-900">
                    {amountReceived && amountReceived * 100 >= totals.totalMinor 
                      ? formatMinor(Math.round(amountReceived * 100) - totals.totalMinor) 
                      : "—"}
                  </span>
                </div>
             </div>
           )}

           {saleError && <p className="text-[12px] text-rose-600 font-medium mt-1">{saleError}</p>}

           <button 
             onClick={completeSale}
             id="complete-sale-btn"
             disabled={submitting || cart.length === 0}
             className="w-full h-[50px] bg-[#10b981] hover:bg-[#059669] text-white font-bold text-[14px] rounded-[8px] flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-3"
           >
             <Package className="w-5 h-5"/>
             {submitting ? "Completing..." : "Complete Sale"}
           </button>
        </div>
      </div>
    </div>
  );
}
`;

const newCode = code.substring(0, startIndex) + replacement + code.substring(endIndex);
fs.writeFileSync(file, newCode);
console.log("Replaced footer to be smaller.");
