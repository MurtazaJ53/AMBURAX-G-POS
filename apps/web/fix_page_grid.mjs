import fs from 'fs';
let f = 'src/app/(app)/dashboard/page.tsx';
let c = fs.readFileSync(f, 'utf8');

c = c.replace(/xl:grid-cols-\[minmax\(0,1\.7fr\)_minmax\(250px,\.82fr\)_minmax\(220px,\.68fr\)\]/, "xl:grid-cols-[56fr_24fr_20fr]");
c = c.replace(/xl:grid-cols-\[1\.02fr_1fr_1\.12fr\]/, "xl:grid-cols-3");
c = c.replace(/xl:grid-cols-\[1\.3fr_1fr_1fr_1\.3fr\]/, "xl:grid-cols-4");

fs.writeFileSync(f, c);
