/* Every /api/… path the pages ask for has a handler registered in the
   browser data layer (there is no server to answer anything else), and
   nothing still points at the Cloudflare code that was removed. */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import vm from 'node:vm';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + e.message); } };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (['node_modules', '.git', '_dev', '_site'].includes(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const code = files.filter((f) => ['.js', '.html'].includes(extname(f)) && !f.includes('/assets/vendor/'));

// Load every data-layer script with a recording router.
const routes = [];
const ctx = { console, URL, URLSearchParams, crypto: globalThis.crypto, setTimeout };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(resolve(ROOT, 'assets/js/db.js'), 'utf8'), ctx);
const realRoute = ctx.TNData.route;
ctx.TNData.route = (m, p, fn) => { routes.push(m.toUpperCase() + ' ' + p); realRoute(m, p, fn); };
for (const f of ['assets/js/routes-core.js', 'kept/kept-core.js', 'kept/kept-data.js', 'spent/spent-engine.js', 'spent/spent-data.js', 'decided/decided-engine.js', 'decided/decided-data.js']) {
  if (existsSync(resolve(ROOT, f))) vm.runInContext(readFileSync(resolve(ROOT, f), 'utf8'), ctx);
}
const patterns = routes.map((r) => { const [m, p] = r.split(' '); return new RegExp('^' + p.replace(/:[a-z_]+/gi, '[^/]+') + '/?$'); });

t('the data layer registers the routes', () => ok(routes.length >= 40, routes.length + ' routes'));
t('every /api/ path in the pages and scripts has a handler', () => {
  const missing = new Set();
  for (const f of code) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/['"`](\/api\/[a-z0-9_\-/]*)/gi)) {
      let p = m[1].replace(/\/$/, '');
      if (p === '/api' || /\/api\/[a-z]+$/.test(p)) continue;   // a prefix being built up, e.g. '/api/kept/' + name
      const probe = p.split('/').length <= 4 ? p : p;        // a path ending in a variable segment matches :param
      if (!patterns.some((rx) => rx.test(probe) || rx.test(probe + '/x'))) missing.add(f.slice(ROOT.length + 1) + ' → ' + p);
    }
  }
  ok(!missing.size, [...missing].join('; '));
});
t('nothing refers to the Cloudflare code, bindings or AI any more', () => {
  const bad = [];
  for (const f of code) {
    const src = readFileSync(f, 'utf8');
    if (/functions\/api|wrangler|env\.DB|env\.AI|Workers AI|\/api\/kept\/ai\b|_redirects/.test(src)) bad.push(f.slice(ROOT.length + 1));
  }
  ok(!bad.length, bad.join(', '));
});
t('the Cloudflare files are gone', () => {
  for (const f of ['functions', 'wrangler.toml', '_headers', '_redirects', 'db']) ok(!existsSync(resolve(ROOT, f)), f + ' still exists');
});
t('GitHub Pages needs .nojekyll (no Jekyll pass over the files), the test workflow, and no CNAME (it lives at niyaz8951.github.io/Reckon/)', () => {
  ok(existsSync(resolve(ROOT, '.nojekyll'))); ok(existsSync(resolve(ROOT, '.github/workflows/test.yml')));
  ok(!existsSync(resolve(ROOT, 'CNAME')), 'a CNAME would point the site at a custom domain');
});
t('config.js holds only the public anon key slot — never a service_role key', () => {
  const s = readFileSync(resolve(ROOT, 'assets/js/config.js'), 'utf8');
  ok(/supabaseAnonKey/.test(s)); ok(!/service_role['"]?\s*:/.test(s));
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
