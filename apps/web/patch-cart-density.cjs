const fs = require('fs');
let code = fs.readFileSync('src/app/(app)/pos/PosTerminal.tsx', 'utf8');

// 1. Footer Container padding/gaps
code = code.replace(
  'className="bg-white border-t border-slate-200 p-4 pb-6 flex flex-col gap-4 shadow-[0_-4px_10px_rgba(0,0,0,0.02)] z-10"',
  'className="bg-white border-t border-slate-200 p-3 pb-3 flex flex-col gap-3 shadow-[0_-4px_10px_rgba(0,0,0,0.02)] z-10"'
);

// 2. Add Discount Input
code = code.replace(
  '<input disabled placeholder="Add Discount" className="flex-1 text-[13px] border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-slate-500 cursor-not-allowed" />',
  '<input disabled placeholder="Add Discount" className="flex-1 text-[12px] border border-slate-200 rounded-lg px-3 py-1.5 bg-slate-50 text-slate-500 cursor-not-allowed" />'
);
code = code.replace(
  '<button disabled className="px-3 py-2 bg-slate-50 border-r border-slate-200 text-[13px] font-medium text-slate-600">%</button>',
  '<button disabled className="px-3 py-1.5 bg-slate-50 border-r border-slate-200 text-[12px] font-medium text-slate-600">%</button>'
);
code = code.replace(
  '<button disabled className="px-3 py-2 bg-white text-[13px] font-medium text-slate-600">???</button>',
  '<button disabled className="px-3 py-1.5 bg-white text-[12px] font-medium text-slate-600">₹</button>'
);
code = code.replace(
  '<button disabled className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg text-[13px] font-medium text-slate-400">Apply</button>',
  '<button disabled className="px-4 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-[12px] font-medium text-slate-400">Apply</button>'
);

// 3. Totals Table
code = code.replace(
  '<div className="flex flex-col gap-2 text-[13px]">',
  '<div className="flex flex-col gap-1 text-[12px]">'
);
code = code.replace(
  '<div className="flex justify-between text-[20px] font-bold text-blue-700 mt-1 pt-2 border-t border-slate-100">',
  '<div className="flex justify-between text-[16px] font-bold text-blue-700 mt-1 pt-1.5 border-t border-slate-100">'
);

// 4. Payment Modes
code = code.replace(
  '<p className="text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wider">Payment Mode</p>',
  '<p className="text-[10px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Payment Mode</p>'
);
code = code.replace(
  /className={`flex-1 py-2 px-1 text-\[12px\]/g,
  'className={`flex-1 py-1.5 px-1 text-[11px]'
);

// 5. Amount Received
code = code.replace(
  '<div className="flex flex-col gap-2">',
  '<div className="flex flex-col gap-1.5">'
);
code = code.replace(
  '<span className="text-[12px] font-medium text-slate-700">Amount Received</span>',
  '<span className="text-[11px] font-medium text-slate-700">Amount Received</span>'
);
code = code.replace(
  '<input \n                    type="number"',
  '<input \n                    type="number"'
); // Just checking, but the class is below
code = code.replace(
  'className="w-32 text-right text-[13px] font-bold border border-slate-200 rounded-md px-3 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"',
  'className="w-28 text-right text-[12px] font-bold border border-slate-200 rounded-md px-3 py-1 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"'
);

// Quick buttons are mostly fine, but let's change text size to 11px
code = code.replace(
  /className="flex-1 text-\[12px\] border border-blue-200 text-blue-600 bg-blue-50 rounded py-1.5 font-medium"/g,
  'className="flex-1 text-[11px] border border-blue-200 text-blue-600 bg-blue-50 rounded py-1 font-medium"'
);
code = code.replace(
  'className="flex-[1.5] text-[12px] border border-blue-200 text-blue-700 bg-blue-100 rounded py-1.5 font-bold">Exact</button>',
  'className="flex-[1.5] text-[11px] border border-blue-200 text-blue-700 bg-blue-100 rounded py-1 font-bold">Exact</button>'
);
code = code.replace(
  '<div className="flex justify-between items-center text-[13px]">',
  '<div className="flex justify-between items-center text-[12px]">'
);

// 6. Complete Sale Button
code = code.replace(
  'className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-base py-3.5 rounded-lg flex items-center justify-center gap-2 shadow-sm shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed mt-1 transition-colors"',
  'className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-[14px] py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-sm shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed mt-0.5 transition-colors"'
);

// 7. Cart Items List container
code = code.replace(
  '<div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">',
  '<div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">'
);

// 8. Individual Cart Item
code = code.replace(
  'className="flex gap-3 bg-white p-3 rounded-lg border border-slate-200 shadow-sm relative group"',
  'className="flex gap-2.5 bg-white p-2 rounded-lg border border-slate-200 shadow-sm relative group"'
);
code = code.replace(
  'className="w-14 h-16 bg-slate-50 rounded border border-slate-100 flex items-center justify-center overflow-hidden shrink-0"',
  'className="w-10 h-12 bg-slate-50 rounded border border-slate-100 flex items-center justify-center overflow-hidden shrink-0"'
);
code = code.replace(
  '<p className="text-[13px] font-medium text-slate-900 leading-snug truncate">{line.productName}</p>',
  '<p className="text-[12px] font-medium text-slate-900 leading-snug truncate">{line.productName}</p>'
);
// SKU is text-[11px], let's keep it or change to text-[10px]
code = code.replace(
  '<p className="text-[11px] text-slate-500 mt-0.5 truncate">{line.sku} {variantLabel(line) ? `| ${variantLabel(line)}` : \'\'}</p>',
  '<p className="text-[10px] text-slate-500 mt-0.5 truncate">{line.sku} {variantLabel(line) ? `| ${variantLabel(line)}` : \'\'}</p>'
);
code = code.replace(
  '<p className="text-[13px] font-bold text-slate-900">{formatMinor(line.unitPriceMinor)}</p>',
  '<p className="text-[12px] font-bold text-slate-900">{formatMinor(line.unitPriceMinor)}</p>'
);

// Quantity controls
code = code.replace(
  /className="w-7 h-7 flex items-center justify-center text-blue-600 hover:bg-slate-100 rounded-l-md"/g,
  'className="w-6 h-6 flex items-center justify-center text-blue-600 hover:bg-slate-100 rounded-l-md"'
);
code = code.replace(
  /className="w-7 h-7 flex items-center justify-center text-blue-600 hover:bg-slate-100 rounded-r-md"/g,
  'className="w-6 h-6 flex items-center justify-center text-blue-600 hover:bg-slate-100 rounded-r-md"'
);
code = code.replace(
  /<Minus className="w-3\.5 h-3\.5"\/>/g,
  '<Minus className="w-3 h-3"/>'
);
code = code.replace(
  /<Plus className="w-3\.5 h-3\.5"\/>/g,
  '<Plus className="w-3 h-3"/>'
);
code = code.replace(
  '<span className="w-8 text-center text-[13px] font-medium text-slate-900">{line.quantity}</span>',
  '<span className="w-7 text-center text-[12px] font-medium text-slate-900">{line.quantity}</span>'
);

// Trash button
code = code.replace(
  'className="absolute top-3 right-3 text-slate-300 hover:text-rose-500"',
  'className="absolute top-2 right-2 text-slate-300 hover:text-rose-500"'
);
code = code.replace(
  '<Trash2 className="w-4 h-4"/>',
  '<Trash2 className="w-3.5 h-3.5"/>'
);

// Cart Tabs 
code = code.replace(
  '<div className="flex px-4 pt-4 border-b border-slate-200 gap-6 text-[13px] font-medium bg-white">',
  '<div className="flex px-4 pt-3 border-b border-slate-200 gap-6 text-[13px] font-medium bg-white">'
);
code = code.replace(
  '<button className="pb-3 border-b-2 border-blue-600 text-blue-600">Cart ({cart.reduce((a,b)=>a+b.quantity, 0)})</button>',
  '<button className="pb-2.5 border-b-2 border-blue-600 text-blue-600">Cart ({cart.reduce((a,b)=>a+b.quantity, 0)})</button>'
);
code = code.replace(
  '<button className="pb-3 border-b-2 border-transparent text-slate-500 hover:text-slate-700">Customer</button>',
  '<button className="pb-2.5 border-b-2 border-transparent text-slate-500 hover:text-slate-700">Customer</button>'
);

// Customer Picker Block inside right panel
code = code.replace(
  '<div className="p-4 bg-white border-b border-slate-200 shadow-sm z-10">',
  '<div className="p-3 bg-white border-b border-slate-200 shadow-sm z-10">'
);

fs.writeFileSync('src/app/(app)/pos/PosTerminal.tsx', code);
console.log("Patched right panel layout.");
