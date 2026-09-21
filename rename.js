const fs = require('fs');
const path = require('path');
function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('"/home"')) {
        content = content.replace(/"\/home"/g, '"/dashboard"');
        fs.writeFileSync(fullPath, content);
      }
    }
  }
}
walk('apps/web/src');
