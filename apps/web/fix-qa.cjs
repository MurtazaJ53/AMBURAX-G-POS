const fs = require('fs');
let code = fs.readFileSync('qa-pos-geometry.cjs', 'utf8');
code = code.replace("footer.querySelector('button:last-child')", "footer.querySelector('#complete-sale-btn')");
fs.writeFileSync('qa-pos-geometry.cjs', code);
