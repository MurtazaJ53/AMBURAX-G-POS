import fs from 'fs';

const file = 'D:/G-POS/apps/web/src/app/auth/login/LoginForm.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace the form tag to prevent native navigation
content = content.replace(
  /<form className="space-y-5" onSubmit=\{handleSubmit\} method="POST" action="\/api\/v1\/auth\/login" noValidate>/,
  '<form className="space-y-5" onSubmit={handleSubmit} action="javascript:void(0);" noValidate>'
);

fs.writeFileSync(file, content, 'utf8');
