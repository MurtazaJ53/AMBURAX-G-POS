import fs from 'fs';
import path from 'path';

let p = path.join(process.cwd(), 'apps/web/capture.cjs');
let c = fs.readFileSync(p, 'utf8');

c = c.replace(/input\[name="email"\]/g, 'input[id="email"]');
c = c.replace(/input\[name="password"\]/g, 'input[id="password"]');

fs.writeFileSync(p, c);
console.log("Fixed capture script");
