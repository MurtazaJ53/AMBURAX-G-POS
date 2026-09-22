import fs from 'fs';
import path from 'path';

let p = path.join(process.cwd(), 'apps/web/src/app/(app)/pos/PosTerminal.tsx');
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  /import \{ Search, Plus, Minus, Trash2, Package, LayoutGrid, CheckCircle2, SlidersHorizontal, Barcode, Zap \} from "lucide-react";/,
  `import { Search, Plus, Minus, Trash2, Package, LayoutGrid, CheckCircle2, SlidersHorizontal, Barcode, Zap, ChevronDown, AlignJustify, Shirt, Users, Tag } from "lucide-react";`
);

fs.writeFileSync(p, c);
console.log("Updated PosTerminal.tsx imports");
