const fs = require('fs');
const file = 'apps/web/src/components/shell/AppSidebar.tsx';
let c = fs.readFileSync(file, 'utf8');
c = c.replace('return pathname === href || pathname.startsWith(\"\\/\");', 'return pathname === href || pathname.startsWith(href + \"/\");');
fs.writeFileSync(file, c, 'utf8');
