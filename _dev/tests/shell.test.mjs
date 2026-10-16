/* The shell: chrome paints before the server answers, the user hint is
   remembered and cleared, scripts load on demand, and the service worker
   keeps to its rules. jsdom for the page, source checks for the worker.
   All data invented. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const globalJs = readFileSync(resolve(ROOT, 'assets/js/global.js'), 'utf8');

function page({ url = 'https://reckon.test/', cached, me, delay = 50 } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  if (cached) window.localStorage.setItem('tn-user', JSON.stringify(cached));
  let release;
  const gate = new Promise((r) => { release = r; });
  window.__calls = [];
  // global.js sends /api/ paths to TNData.handle (db.js in the real site).
  window.TNData = {
    async handle(method, path) {
      window.__calls.push(path);
      if (delay === 'gate') await gate; else await tick(delay);
      return { user: me === undefined ? null : (me && { status: 'active', ...me }) };
    },
    auth: { signOut: async () => {} }
  };
  window.scrollTo = () => {};
  window.eval(globalJs);
  return { window, document: window.document, release };
}

await t('TN.ready runs a late listener too: the session can be known before a page script is parsed', async () => {
  const p = page({ me: { id: 'usr_a', name: 'Niyaz', email: 'n@example.com', role: 'user' }, delay: 1 });
  await tick(30);
  eq(p.window.TN.session.loaded, true, 'already loaded');
  let got = null;
  p.window.TN.ready((e) => { got = e.detail; });
  await tick(5);
  ok(got && got.user && got.user.id === 'usr_a', 'called after the fact with the session');
  // and before: queued on the event
  const q = page({ me: { id: 'usr_b', name: 'B', email: 'b@example.com', role: 'user' }, delay: 'gate' });
  let early = null;
  q.window.TN.ready((e) => { early = e.detail; });
  q.release(); await tick(30);
  ok(early && early.user && early.user.id === 'usr_b', 'called when it fires');
  const pages = ['spent/index.html', 'decided/index.html', 'account/index.html', 'index.html', 'admin/index.html', 'spent/spent.js', 'decided/decided.js', 'account/account.js'];
  for (const f of pages) ok(!/addEventListener\('tn:ready'/.test(readFileSync(resolve(ROOT, f), 'utf8')), f + ' listens through TN.ready');
});
await t('the header, footer and tab bar are painted synchronously from the remembered user, before any request answers', async () => {
  const p = page({ cached: { id: 'usr_a', name: 'Niyaz', email: 'n@example.com', role: 'user' }, me: { id: 'usr_a', name: 'Niyaz', email: 'n@example.com', role: 'user' }, delay: 'gate' });
  // Nothing has answered yet (the fetch is gated), and the chrome is there.
  ok(p.document.querySelector('.site-header .brand'), 'brand');
  ok(!p.document.querySelector('.site-header [data-signout]'), 'sign-out lives in Account, not the header');
  const av = p.document.querySelector('.site-header a.header-avatar[href="/account/"]');
  ok(av, 'avatar link to Account'); ok(/Niyaz/.test(av.getAttribute('aria-label'))); eq(av.textContent, 'N', 'initials when there is no photo');
  eq(p.document.querySelector('.site-header__title').textContent, 'RECKON');
  ok(p.document.querySelector('.tab-bar'), 'tab bar');
  ok(p.document.querySelector('.site-footer nav'), 'footer');
  eq(p.window.TN.session.loaded, false);
  p.release(); await tick(10);
  eq(p.window.TN.session.loaded, true);
  eq(p.document.querySelectorAll('.site-header').length, 1); eq(p.document.querySelectorAll('.tab-bar').length, 1, 'no duplicate bar after the repaint');
});
await t('with nothing remembered the chrome still paints at once, and the server\'s answer fills in the name and is remembered', async () => {
  const p = page({ me: { id: 'usr_a', name: 'Niyaz', email: 'n@example.com', role: 'admin' } });
  ok(p.document.querySelector('.site-header .brand'));
  await tick(80);
  ok(/Niyaz/.test(p.document.querySelector('.site-header a.header-avatar').getAttribute('aria-label')));
  ok(p.document.querySelector('.site-header a[href="/admin/"]'), 'admin link after the answer (wide screens)');
  eq(JSON.parse(p.window.localStorage.getItem('tn-user')).role, 'admin');
});
await t('on the sign-in page nobody is assumed: no tab bar, a Sign in button', async () => {
  const p = page({ url: 'https://reckon.test/login/', cached: { id: 'usr_a', name: 'X', email: 'x@example.com', role: 'user' } });
  ok(!p.document.querySelector('.tab-bar')); ok(!p.document.querySelector('.site-header .header-avatar'), 'no avatar for nobody');
});
await t('the server saying "nobody" clears the remembered user and guard() redirects', async () => {
  const p = page({ cached: { id: 'usr_a', name: 'X', email: 'x@example.com', role: 'user' }, me: null });
  // jsdom will not navigate; the "not implemented" it reports is the redirect being attempted.
  let attempted = false;
  p.window.addEventListener('error', () => { attempted = true; });
  p.window.TN.guard();
  await tick(80);
  eq(p.window.localStorage.getItem('tn-user'), null);
  eq(p.window.TN.session.user, null);
  ok(!p.document.querySelector('.tab-bar'), 'the bar leaves with the user');
});
await t('TN.loadScript appends a script once per src and TN.clearLocal drops the user hint', async () => {
  const p = page({ me: { id: 'usr_a', email: 'a@example.com', role: 'user' } });
  await tick(80);
  p.window.TN.loadScript('/assets/vendor/chart.umd.js?v=1'); p.window.TN.loadScript('/assets/vendor/chart.umd.js?v=1');
  eq(p.document.querySelectorAll('head script[src="/assets/vendor/chart.umd.js?v=1"]').length, 1);
  p.window.TN.clearLocal();
  eq(p.window.localStorage.getItem('tn-user'), null);
});

/* ---------------------------------------------------------- the worker */
const sw = readFileSync(resolve(ROOT, 'sw.js'), 'utf8');
await t('service worker: never caches /api/, keeps the sign-in pages live, clears everything on sign-out', async () => {
  ok(/url\.origin !== self\.location\.origin\) return;/.test(sw), 'Supabase (another origin) is never touched');
  ok(/U\('login\/'\).*U\('signup\/'\)/.test(sw) && /fetch\(req\)\.catch\(\(\) => offline\(\)\)/.test(sw), 'login/signup network-only');
  ok(/TN_SIGNED_OUT/.test(sw) && /keys\.filter\(OURS\)\.map\(\(k\) => caches\.delete\(k\)\)/.test(sw), 'sign-out empties our caches (and only ours: github.io origins are shared)');
  ok(/if \(!url\.pathname\.startsWith\(BASE\)\) return;/.test(sw), 'requests outside the site folder are left alone');
  ok(/keys\.filter\(\(k\) => OURS\(k\) && k !== STATIC/.test(sw), 'activate never deletes another site\'s caches');
  ok(/!res\.redirected/.test(sw), 'a redirect to the sign-in page is never cached under an app URL');
});
await t('service worker: every precached asset exists, and the version was bumped for this drop', async () => {
  const list = [...sw.matchAll(/'(\/[^']+\.[a-z0-9]+(?:\?v=\d+)?)'/g)].map((m) => m[1]).filter((u) => u !== '/sw.js');
  ok(list.length >= 10);
  const { readdirSync, statSync } = await import('node:fs');
  const walk = (d, out = []) => { for (const n of readdirSync(d)) { if (['node_modules', '.git', '_dev'].includes(n)) continue; const p = resolve(d, n); if (statSync(p).isDirectory()) walk(p, out); else if (n.endsWith('.html')) out.push(p); } return out; };
  // Every versioned reference in the markup, resolved from the page's own
  // folder to a site path — links are relative now.
  const refs = new Set();
  for (const f of walk(ROOT)) {
    const dir = '/' + f.slice(ROOT.length + 1).split('/').slice(0, -1).join('/');
    for (const m of readFileSync(f, 'utf8').matchAll(/(?:href|src)="([^"]+\?v=\d+)"/g)) {
      const u = new URL(m[1], 'http://site' + (dir.endsWith('/') ? dir : dir + '/'));
      refs.add(u.pathname + u.search);
    }
  }
  for (const u of list) {
    ok(existsSync(resolve(ROOT, '.' + u.split('?')[0])), 'missing ' + u);
    // A versioned entry must be exactly what the pages ask for, or the
    // precached copy is a cache key nobody ever requests.
    if (u.includes('?v=')) ok(refs.has(u), 'precache entry not referenced by any page: ' + u);
  }
  ok(/const VERSION = 'ssd-hub-v12'/.test(sw));
});
await t('every page sets the theme before first paint, with the same rule', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const walk = (d, out = []) => { for (const n of readdirSync(d)) { if (['node_modules', '.git', '_dev'].includes(n)) continue; const p = resolve(d, n); if (statSync(p).isDirectory()) walk(p, out); else if (n.endsWith('.html')) out.push(p); } return out; };
  const snippets = new Set();
  for (const f of walk(ROOT)) {
    const s = readFileSync(f, 'utf8');
    const m = s.match(/<script>(try\{var m=localStorage\.getItem\('tn-theme'\)[^<]*)<\/script>/);
    ok(m, f + ' has no theme-before-paint script');
    ok(s.indexOf(m[0]) < s.indexOf('<body'), f + ': the theme script must be in <head>');
    snippets.add(m[1]);
  }
  eq(snippets.size, 1, 'every page uses the identical snippet');
});
await t('the [hidden] attribute always wins over a component\'s display', async () => {
  const css = readFileSync(resolve(ROOT, 'assets/css/global.css'), 'utf8');
  ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/.test(css));
});
await t('the system font, no web fonts: no page loads or preloads a font file, and the type tokens are the system stack', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const walk = (d, out = []) => { for (const n of readdirSync(d)) { if (['node_modules', '.git', '_dev'].includes(n)) continue; const p = resolve(d, n); if (statSync(p).isDirectory()) walk(p, out); else if (n.endsWith('.html')) out.push(p); } return out; };
  for (const f of walk(ROOT)) {
    const s = readFileSync(f, 'utf8');
    ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(s), f + ' still points at Google Fonts');
    ok(!/assets\/fonts\//.test(s), f + ' still references a font file');
  }
  const css = readFileSync(resolve(ROOT, 'assets/css/global.css'), 'utf8');
  eq((css.match(/@font-face/g) || []).length, 0);
  ok(/--font-body:\s*system-ui, -apple-system/.test(css) && /--font-heading:\s*system-ui/.test(css), 'system stack');
  ok(/body \{[^}]*font-variant-numeric:\s*tabular-nums/.test(css), 'numbers are tabular');
  ok(!existsSync(resolve(ROOT, 'assets/fonts')), 'font files removed');
  ok(!/fonts\//.test(readFileSync(resolve(ROOT, 'sw.js'), 'utf8')), 'the worker precaches no fonts');
});
await t('section labels are sentence case: no app stylesheet uppercases text', async () => {
  for (const f of ['assets/css/global.css', 'kept/kept.css', 'spent/spent.css', 'decided/decided.css']) {
    const css = readFileSync(resolve(ROOT, f), 'utf8');
    ok(!/text-transform:\s*uppercase/.test(css), f + ' still uppercases a label');
  }
});

/* ------------------------------------------------------- sub-path hosting */
await t('links are relative, so the site works at a domain root and under /Reckon/', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const walk = (d, out = []) => { for (const n of readdirSync(d)) { if (['node_modules', '.git', '_dev'].includes(n)) continue; const p = resolve(d, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(html|css|webmanifest)$/.test(n)) out.push(p); } return out; };
  for (const f of walk(ROOT)) {
    const s = readFileSync(f, 'utf8');
    ok(!/(?:href|src|action)="\/(?!\/|api\/)/.test(s), f + ' has a root-absolute link');
    ok(!/url\(['"]?\/(?!\/)/.test(s), f + ' has a root-absolute url()');
    ok(!/"(?:start_url|scope|id|url|src)": "\//.test(s), f + ' has a root-absolute manifest path');
  }
});
await t('global.js finds its base from its own address and builds every link from it', async () => {
  const html = '<!doctype html><html><body><header data-site-header></header><main></main><footer data-site-footer></footer></body></html>';
  const dom = new JSDOM(html, { url: 'https://niyaz8951.github.io/Reckon/kept/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  w.TNData = { handle: async () => ({ user: { id: 'u1', name: 'A', email: 'a@x.test', role: 'admin', status: 'active' } }) };
  Object.defineProperty(w.document, 'currentScript', { configurable: true, value: { src: 'https://niyaz8951.github.io/Reckon/assets/js/global.js?v=37' } });
  w.eval(readFileSync(resolve(ROOT, 'assets/js/global.js'), 'utf8'));
  eq(w.TN.base, '/Reckon/');
  eq(w.TN.url('kept/settings/'), '/Reckon/kept/settings/');
  eq(w.TN.url('/login/'), '/Reckon/login/');
  eq(w.TN.sitePath(), '/kept/');
  eq(w.TN.app('kept').href, '/Reckon/kept/');
  eq(w.TN.currentApp().slug, 'kept', 'the current app is found under the sub-path');
  await new Promise((r) => setTimeout(r, 30));
  const hrefs = [...w.document.querySelectorAll('header a, footer a')].map((a) => a.getAttribute('href'));
  ok(hrefs.length > 3 && hrefs.every((h) => h.indexOf('/Reckon/') === 0), 'chrome links stay inside the site: ' + hrefs.join(' '));
});
await t('the worker registers for the site folder only', async () => {
  const pwa = readFileSync(resolve(ROOT, 'assets/js/pwa.js'), 'utf8');
  ok(/register\(window\.TN\.url\('sw\.js'\), \{ scope: window\.TN\.base \}\)/.test(pwa));
  ok(/const BASE = new URL\('\.\/', self\.location\)\.pathname;/.test(sw));
  ok(/<base href="' \+ BASE/.test(sw), 'the offline page gets a <base> so its relative links work anywhere');
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
