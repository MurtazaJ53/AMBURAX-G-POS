const fs = require('fs');
let code = fs.readFileSync('src/app/(app)/pos/PosTerminal.tsx', 'utf8');
code = code.replace("bg-white border-t border-slate-200 p-2 flex flex-col shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.03)] z-20", "bg-white border-t border-slate-200 p-3 flex flex-col shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.03)] z-20");
fs.writeFileSync('src/app/(app)/pos/PosTerminal.tsx', code);
