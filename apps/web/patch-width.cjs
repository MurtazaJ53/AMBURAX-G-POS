const fs = require('fs');
let code = fs.readFileSync('src/app/(app)/pos/PosTerminal.tsx', 'utf8');
code = code.replace(/className="w-full w-\[390px\] shrink-0/g, 'className="w-[390px] shrink-0');
fs.writeFileSync('src/app/(app)/pos/PosTerminal.tsx', code);
