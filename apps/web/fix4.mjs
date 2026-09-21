import fs from 'fs';

const file = 'D:/G-POS/apps/web/src/app/auth/login/LoginForm.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Revert form tag to clean onSubmit
content = content.replace(
  /<form className="space-y-5" onSubmit=\{handleSubmit\} action="javascript:void\(0\);" noValidate>/,
  '<form className="space-y-5" onSubmit={handleSubmit} noValidate>'
);

// 2. Remove name attributes to prevent GET parameter leakage
content = content.replace(/name="email"\s*\n\s*/, '');
content = content.replace(/name="password"\s*\n\s*/, '');

fs.writeFileSync(file, content, 'utf8');
