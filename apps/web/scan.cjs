const fs = require('fs');
const path = require('path');
function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      results.push(file);
    }
  });
  return results;
}
const files = walk('./src');
files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const matches = content.match(/\[[^\]]*\.\.\.[^\]]*\]/g);
  if (matches) {
    console.log(f, matches);
  }
});
