const fs = require("fs");
let content = fs.readFileSync("apps/web/src/app/(app)/pos/PosTerminal.tsx", "utf-8");

// State changes
const targetState = `  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [amountReceived, setAmountReceived] = useState<number | null>(null);`;
const replaceState = `  const [method, setMethod] = useState<PaymentMethod | "SPLIT">("CASH");
  const [amountReceived, setAmountReceived] = useState<number | null>(null);
  
  // Split payment state
  const [splitPayments, setSplitPayments] = useState<Array<{ id: string, method: PaymentMethod, amount: number | null, reference: string }>>([
    { id: "1", method: "CASH", amount: null, reference: "" },
    { id: "2", method: "UPI", amount: null, reference: "" }
  ]);`;
content = content.replace(targetState, replaceState);

// Method options update
const targetMethods = `const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
] as const;`;
const replaceMethods = `const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
  { value: "SPLIT", label: "Split" },
] as const;`;
content = content.replace(targetMethods, replaceMethods);

// Complete sale logic update
const targetComplete = `        payment: {
          method: method as PaymentMethod,
          reference: undefined, // TODO: UI for reference
        },`;
const replaceComplete = `        payments: method === "SPLIT" 
          ? splitPayments.filter(p => (p.amount || 0) > 0).map(p => ({
              method: p.method,
              amountMinor: Math.round((p.amount || 0) * 100),
              reference: p.reference.trim() || undefined
            }))
          : [
              {
                method: method as PaymentMethod,
                amountMinor: amountReceived ? Math.round(amountReceived * 100) : totals.totalMinor,
                reference: undefined
              }
            ],`;
content = content.replace(targetComplete, replaceComplete);

// Fix UI replacement
const blockRegex = /\{\/\*\s*Payment Modes\s*\*\/\}.*?(?=\{\/\*\s*Cash Amount Received\s*\*\/\})(?:.*?)(?=\{saleError\s*\&\&\s*<p)/s;

const newUI = `{/* Payment Modes */}
           <div>
             <div className="flex gap-1.5 h-[34px]">
               {PAYMENT_METHODS.map(m => (
                 <button 
                   key={m.value}
                   onClick={() => {
                     setMethod(m.value as any);
                     if (m.value !== "SPLIT") {
                       setAmountReceived(null);
                     }
                   }}
                   className={\`flex-1 text-[11px] font-bold rounded-[6px] border transition-colors \${method === m.value ? 'bg-[#10b981] border-[#10b981] text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}\`}
                 >
                   {m.label}
                 </button>
               ))}
             </div>
           </div>

           {/* Single Payment: Cash Amount Received */}
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

           {/* Split Payment */}
           {method === 'SPLIT' && (
             <div className="flex flex-col mt-2 gap-2 max-h-[160px] overflow-y-auto pr-1 no-scrollbar">
                {splitPayments.map((p, i) => (
                  <div key={p.id} className="flex gap-1.5 items-center bg-white border border-slate-200 rounded-[6px] p-1.5">
                    <select
                      value={p.method}
                      onChange={(e) => setSplitPayments(curr => curr.map(x => x.id === p.id ? { ...x, method: e.target.value as PaymentMethod } : x))}
                      className="w-20 text-[11px] font-bold border-none bg-slate-50 rounded px-1 h-[28px] outline-none text-slate-700 focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="CASH">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="CARD">Card</option>
                    </select>
                    
                    {p.method !== "CASH" ? (
                      <input
                        placeholder="Ref (Opt)"
                        value={p.reference}
                        onChange={(e) => setSplitPayments(curr => curr.map(x => x.id === p.id ? { ...x, reference: e.target.value } : x))}
                        className="flex-1 text-[11px] border border-slate-200 rounded px-1.5 h-[28px] outline-none focus:border-blue-500 w-16"
                      />
                    ) : (
                      <div className="flex-1 w-16"></div>
                    )}
                    
                    <input
                      type="number"
                      placeholder="Amt"
                      value={p.amount ?? ''}
                      onChange={(e) => setSplitPayments(curr => curr.map(x => x.id === p.id ? { ...x, amount: e.target.value ? parseFloat(e.target.value) : null } : x))}
                      className="w-[72px] text-right text-[12px] font-bold border border-slate-200 rounded px-1.5 h-[28px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                    
                    <button 
                      onClick={() => setSplitPayments(curr => curr.filter(x => x.id !== p.id))}
                      className="w-6 h-[28px] flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded"
                    >
                      ×
                    </button>
                  </div>
                ))}
                
                <button 
                  onClick={() => setSplitPayments(curr => [...curr, { id: Date.now().toString(), method: "CASH", amount: null, reference: "" }])}
                  className="w-full h-[30px] border border-dashed border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-[6px] text-[11px] font-semibold transition-colors shrink-0"
                >
                  + Add Payment Row
                </button>
                
                {(() => {
                  const splitSum = splitPayments.reduce((acc, curr) => acc + Math.round((curr.amount || 0) * 100), 0);
                  const rem = totals.totalMinor - splitSum;
                  const hasCash = splitPayments.some(p => p.method === "CASH" && (p.amount || 0) > 0);
                  const over = splitSum - totals.totalMinor;
                  
                  return (
                    <div className="flex justify-between items-center text-[13px] h-[26px] mt-1 px-1 shrink-0">
                      <span className="font-semibold text-slate-500">{rem > 0 ? "Remaining" : "Balance"}</span>
                      <span className={\`font-bold \${rem > 0 ? "text-amber-600" : "text-slate-900"}\`}>
                        {rem > 0 ? formatMinor(rem) : (over > 0 && hasCash ? formatMinor(over) : "—")}
                      </span>
                    </div>
                  );
                })()}
             </div>
           )}

           `;

content = content.replace(blockRegex, newUI);
fs.writeFileSync("apps/web/src/app/(app)/pos/PosTerminal.tsx", content);
