/* Every local href/src in the HTML must point at a file that exists.
   This is what catches a nav entry or a stylesheet left pointing at a file
   that was renamed or removed. */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const SKIP = new Set(['node_modules', '.git', '_dev', 'docs']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(p) === '.html') out.push(p);
  }
  return out;
}

// /api/* is answered in the browser by TNData routes, not by a file.
const VIRTUAL = [/^\/api\//, /^\/$/];

let checked = 0; const bad = [];
for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8');
  const re = /(?:href|src)="(\/[^"#?]*)(?:\?[^"]*)?"/g;
  let m;
  while ((m = re.exec(src))) {
    const url = m[1];
    if (VIRTUAL.some((v) => v.test(url))) continue;
    checked++;
    const target = join(ROOT, url.endsWith('/') ? url + 'index.html' : url);
    if (!existsSync(target)) bad.push(`${file.slice(ROOT.length + 1)} -> ${url}`);
  }
}

console.log(`${checked} local asset links checked`);
if (bad.length) {
  console.log('MISSING:');
  bad.forEach((b) => console.log('  ' + b));
  process.exit(1);
}
console.log('all resolve');
