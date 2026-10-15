/* Every icon name the catalogue or the chrome asks for must exist. A missing
   name falls back to `square`, which is why two tabs on the phone rendered as
   blank boxes — silent, and invisible until someone looks at a screenshot. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const SKIP = new Set(['node_modules', '.git', '_dev', 'vendor']);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (['.html', '.js'].includes(extname(p)) && !p.endsWith('global.js')) out.push(p);
  }
  return out;
}

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log('PASS  ' + name))
                                 : (fail++, console.log('FAIL  ' + name)); };

const global_ = readFileSync(resolve(ROOT, 'assets/js/global.js'), 'utf8');
const start = global_.indexOf('var P =');
const block = global_.slice(start, global_.indexOf('\n  };', start));
const have = new Set([...block.matchAll(/^\s{4}'?([a-zA-Z0-9-]+)'?:/gm)].map((m) => m[1]));

t('the icon set was found', have.size > 20);
t('square exists as the fallback', have.has('square'));

// Names the chrome hardcodes.
for (const n of ['home', 'user', 'layers', 'moon', 'log-out', 'arrow-right', 'trash', 'check', 'alert-triangle']) {
  t(`chrome icon "${n}" exists`, have.has(n));
}

// Every app in the registry names an icon that exists.
const reg = global_.slice(global_.indexOf('var APPS = ['), global_.indexOf('];', global_.indexOf('var APPS = [')));
const appIcons = [...reg.matchAll(/icon:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
t('the app registry was found', appIcons.length >= 3);
for (const n of appIcons) t(`app icon "${n}" exists`, have.has(n));

// Every TN.icon('name') call in the apps' own pages and scripts resolves.
const used = new Set();
for (const f of walk(ROOT)) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/TN\.icon\(\s*'([a-z0-9-]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/(?:^|[^A-Za-z_.])icon\(\s*'([a-z0-9-]+)'/g)) used.add(m[1]);
}
for (const n of [...used].sort()) t(`used icon "${n}" exists`, have.has(n));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
