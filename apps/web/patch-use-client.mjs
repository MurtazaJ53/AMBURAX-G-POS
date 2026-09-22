import fs from 'fs';
import path from 'path';

let p = path.join(process.cwd(), 'apps/web/src/app/(app)/pos/PosTerminal.tsx');
let c = fs.readFileSync(p, 'utf8');

c = `"use client";\n` + c;

fs.writeFileSync(p, c);
console.log("Added use client");
