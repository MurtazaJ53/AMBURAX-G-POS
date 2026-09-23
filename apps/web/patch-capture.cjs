const fs = require('fs');
let code = fs.readFileSync('capture.cjs', 'utf8');
code = code.replace('const page = await context.newPage();', `const page = await context.newPage();
page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));`);
fs.writeFileSync('capture.cjs', code);
