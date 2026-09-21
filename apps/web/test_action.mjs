import fs from 'fs';

const file = 'D:/G-POS/apps/web/src/app/auth/login/LoginForm.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace handleSubmit signature
content = content.replace(
  /async function handleSubmit\(e: FormEvent<HTMLFormElement>\) \{\n\s*e\.preventDefault\(\);/,
  'async function handleSubmit() {'
);

// Replace form tag
content = content.replace(
  /<form className="space-y-5" onSubmit=\{handleSubmit\} method="POST" action="\/api\/v1\/auth\/login" noValidate>/,
  '<form className="space-y-5" action={handleSubmit} noValidate>'
);

fs.writeFileSync(file, content, 'utf8');
