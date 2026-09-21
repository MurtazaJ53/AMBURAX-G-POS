import fs from 'fs';

const file = 'src/app/auth/login/LoginForm.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace form with POST method
content = content.replace(
  /<form className="space-y-5" onSubmit=\{handleSubmit\} noValidate>/,
  '<form className="space-y-5" onSubmit={handleSubmit} method="POST" action="/api/v1/auth/login" noValidate>'
);

fs.writeFileSync(file, content, 'utf8');
