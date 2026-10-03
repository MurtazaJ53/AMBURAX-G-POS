const fs = require('fs');
let code = fs.readFileSync('apps/web/src/app/(app)/sales/page.tsx', 'utf8');

code = code.replace(
  /<div className="flex w-full flex-col p-5 max-w-\[1600px\] mx-auto">[\s\S]*<\/div>\n  \);\n}/m,
  `<div className="amb-content w-full">\n      <SalesWorkspace\n        page={result}\n        summary={summary}\n        analytics={analytics}\n        carriedParams={carried}\n      />\n    </div>\n  );\n}`
);

fs.writeFileSync('apps/web/src/app/(app)/sales/page.tsx', code);
