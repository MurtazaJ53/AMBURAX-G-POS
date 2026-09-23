const fs = require('fs');
let code = fs.readFileSync('src/app/(app)/pos/PosTerminal.tsx', 'utf8');

const startStr = "{/* Right Checkout Panel - 30% */}";
const endStr = "function ActionBtn";

const startIndex = code.indexOf(startStr);
const endIndex = code.indexOf(endStr);

if (startIndex === -1 || endIndex === -1) {
  console.error("Could not find boundaries");
  process.exit(1);
}

const replacement = `{/* Right Checkout Panel - ~390px Desktop */}
      <div className="w-[390px] shrink-0 flex flex-col bg-slate-50/30 lg:border-l border-slate-200 h-[50vh] lg:h-full">
        
        {/* Header (~50px) */}
        <div className="flex px-4 h-[50px] items-center border-b border-slate-200 gap-6 text-[13px] font-medium bg-white shrink-0">
          <button className="h-full border-b-2 border-blue-600 text-blue-600 font-semibold">Cart ({cart.reduce((a,b)=>a+b.quantity, 0)})</button>
          <button className="h-full border-b-2 border-transparent text-slate-500 hover:text-slate-700 transition-colors">Customer</button>
        </div>

        {/* Customer Block (~80px) */}
        <div className="p-3 bg-white border-b border-slate-100 shrink-0">
          <CustomerPicker customer={customer} onChange={setCustomer} />
        </div>

        {/* Cart Items (Scrollable) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2 bg-slate-50/50">
          {cartNotice && (
             <p className="text-[12px] text-rose-700 bg-rose-50 p-2 rounded shrink-0">{cartNotice}</p>
          )}
          {cart.map((line) => (
             <div key={line.variantId} className="flex gap-2.5 bg-white p-2 rounded-md border border-slate-200/70 shadow-sm relative group shrink-0">
                <div className="w-10 h-10 bg-slate-50 rounded-[6px] border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                   {line.imageUrl ? (
                     /* eslint-disable-next-line @next/next/no-img-element */
                     <img src={line.imageUrl} alt={line.productName} className="w-full h-full object-cover" />
                   ) : (
                     <Package className="w-5 h-5 text-slate-300" />
                   )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                   <div className="pr-6 leading-tight mb-1">
                     <p className="text-[12px] font-medium text-slate-900 truncate">{line.productName}</p>
                     <p className="text-[10px] text-slate-500 truncate">{line.sku} {variantLabel(line) ? \`| \${variantLabel(line)}\` : ''}</p>
                   </div>
                   <div className="flex items-center justify-between">
                     <p className="text-[12px] font-bold text-slate-900">{formatMinor(line.unitPriceMinor)}</p>
                     
                     <div className="flex items-center border border-slate-200 rounded text-slate-600 bg-slate-50 shadow-sm">
                        <button onClick={() => setQuantity(line.variantId, line.quantity - 1)} className="w-6 h-6 flex items-center justify-center hover:bg-slate-200 transition-colors rounded-l"><Minus className="w-3 h-3"/></button>
                        <span className="w-6 text-center text-[12px] font-semibold text-slate-900 bg-white border-x border-slate-200 h-6 flex items-center justify-center">{line.quantity}</span>
                        <button onClick={() => setQuantity(line.variantId, line.quantity + 1)} className="w-6 h-6 flex items-center justify-center hover:bg-slate-200 transition-colors rounded-r"><Plus className="w-3 h-3"/></button>
                     </div>
                   </div>
                </div>
                <button onClick={() => setQuantity(line.variantId, 0)} className="absolute top-2 right-2 text-slate-300 hover:text-rose-500 transition-colors">
                  <Trash2 className="w-[14px] h-[14px]"/>
                </button>
             </div>
          ))}
          {cart.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-8">
               <Package className="w-10 h-10 mb-2 text-slate-300 opacity-50" />
               <p className="text-[12px] font-medium">Cart is empty</p>
            </div>
          )}
        </div>

        {/* Checkout Footer (Fixed) */}
        <div className="bg-white border-t border-slate-200 px-4 py-3 flex flex-col gap-3 shrink-0 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.05)] z-10">
           
           {/* Discount */}
           <div className="flex gap-2">
             <input disabled placeholder="Add Discount" className="flex-1 text-[12px] border border-slate-200 rounded-[6px] px-2.5 h-[34px] bg-slate-50/50 text-slate-500 cursor-not-allowed outline-none" />
             <div className="flex border border-slate-200 rounded-[6px] overflow-hidden opacity-50 bg-white">
               <button disabled className="px-2.5 h-[34px] border-r border-slate-200 text-[12px] font-medium text-slate-600 bg-slate-50 hover:bg-slate-100">%</button>
               <button disabled className="px-2.5 h-[34px] text-[12px] font-bold text-slate-700 bg-white hover:bg-slate-50">₹</button>
             </div>
             <button disabled className="px-4 h-[34px] bg-slate-100 border border-slate-200 rounded-[6px] text-[12px] font-semibold text-slate-400">Apply</button>
           </div>
           
           <div className="h-px bg-slate-100 w-full"></div>

           {/* Totals */}
           <div className="flex flex-col gap-1 text-[12px]">
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
                <span>GST (Tax)</span>
                <span className="text-slate-400">—</span>
              </div>
              <div className="flex justify-between items-end h-[36px] pt-1">
                <span className="text-[17px] font-bold text-slate-900 leading-none">Total Amount</span>
                <span className="text-[18px] font-bold text-blue-700 leading-none">{formatMinor(totals.totalMinor)}</span>
              </div>
           </div>

           <div className="h-px bg-slate-100 w-full mt-1"></div>

           {/* Payment Modes */}
           <div>
             <p className="text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Payment Mode</p>
             <div className="flex gap-1.5 h-[34px]">
               {PAYMENT_METHODS.map(m => (
                 <button 
                   key={m.value}
                   onClick={() => setMethod(m.value)}
                   className={\`flex-1 text-[11px] font-bold rounded-[6px] border transition-colors \${method === m.value ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'}\`}
                 >
                   {m.label}
                 </button>
               ))}
             </div>
           </div>

           {/* Cash Amount Received */}
           {method === 'CASH' && (
             <div className="flex flex-col gap-2 mt-1">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-semibold text-slate-600">Amount Received</span>
                  <input 
                    type="number"
                    value={amountReceived ?? ''}
                    onChange={(e) => setAmountReceived(e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder={formatMinor(totals.totalMinor)}
                    className="w-28 text-right text-[12px] font-bold border border-slate-200 rounded-[6px] px-2 h-[34px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="flex gap-1.5 h-[32px]">
                  <button onClick={() => setAmountReceived((totals.totalMinor/100) + 1)} className="flex-1 text-[11px] border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors rounded-[6px] font-semibold">+1</button>
                  <button onClick={() => setAmountReceived((totals.totalMinor/100) + 10)} className="flex-1 text-[11px] border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors rounded-[6px] font-semibold">+10</button>
                  <button onClick={() => setAmountReceived((totals.totalMinor/100) + 100)} className="flex-1 text-[11px] border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors rounded-[6px] font-semibold">+100</button>
                  <button onClick={() => setAmountReceived(totals.totalMinor/100)} className="flex-[1.5] text-[11px] border border-blue-300 text-blue-700 bg-blue-100 hover:bg-blue-200 transition-colors rounded-[6px] font-bold">Exact</button>
                </div>
                <div className="flex justify-between items-center text-[12px] h-[28px]">
                  <span className="font-semibold text-slate-500">Balance</span>
                  <span className="font-bold text-slate-900 text-[13px]">
                    {amountReceived && amountReceived * 100 >= totals.totalMinor 
                      ? formatMinor(Math.round(amountReceived * 100) - totals.totalMinor) 
                      : "—"}
                  </span>
                </div>
             </div>
           )}

           {saleError && <p className="text-[12px] text-rose-600 font-medium">{saleError}</p>}

           <button 
             onClick={completeSale}
             disabled={submitting || cart.length === 0}
             className="w-full h-[48px] bg-[#10b981] hover:bg-[#059669] text-white font-bold text-[14px] rounded-[8px] flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-1"
           >
             <Package className="w-4 h-4"/>
             {submitting ? "Completing..." : "Complete Sale (F8)"}
           </button>
        </div>
      </div>
    </div>
  );
}

`;

const newCode = code.substring(0, startIndex) + replacement + code.substring(endIndex);
fs.writeFileSync('src/app/(app)/pos/PosTerminal.tsx', newCode);
console.log("Replaced POS right panel.");
