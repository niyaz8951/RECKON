/* KEPT opens from its on-device snapshot before the server answers, then
   repaints from the bootstrap payload only if it differs; a failed refresh
   keeps the snapshot on screen; a write updates the snapshot. KeptStore is
   replaced with an in-memory stand-in (jsdom has no IndexedDB). All data
   invented. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

import { createRequire } from 'node:module';
import { installApi } from './_stub-api.mjs';
const KC = createRequire(import.meta.url)(resolve(ROOT, 'kept/kept-core.js'));
const { DEFAULT_CATEGORIES } = KC;
const cats = DEFAULT_CATEGORIES.map((c, i) => ({ id: 'kcat_' + i, ...c, sort: i }));
const user = { id: 'usr_s', email: 's@example.com', name: 'Snap', role: 'user', status: 'active' };
const profile = { id: 'kprf_1', currency: 'AED', target_keep_bp: 2000, ramp_months: 6, profile_json: { age: 32, retireAge: 60, ret: 7, infl: 3, nw: 0, kids: [], majors: [], kidCost: 25000000, name: 'Snap' } };
const row = (id, d, descr, amt, cat) => ({ id, d, descr, amount_minor: amt, currency: 'AED', cat, remark: '', hash: id, source: 'import', status: 'approved', created_at: d + 'T00:00:00Z' });
const snapRows = [row('ktx_1', '2026-09-01', 'SALARY — ACME', 1000000, 'Income'), row('ktx_2', '2026-09-03', 'GREENVIEW RENT', -300000, 'Rent'), row('ktx_3', '2026-10-02', 'CITY HYPERMARKET', -42000, 'Grocery')];
const serverRows = snapRows.concat([row('ktx_4', '2026-10-05', 'SUNRISE CAFETERIA', -1400, 'Food')]);

function boot({ snapshot, gateBootstrap, bootstrapFails }) {
  const html = readFileSync(resolve(ROOT, 'kept/index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://reckon.test/kept/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  let release; const gate = new Promise((r) => { release = r; });
  const store = { data: snapshot ? { usr_s: snapshot } : {}, writes: 0 };
  window.localStorage.setItem('tn-user', JSON.stringify(user));
  window.scrollTo = () => {}; window.confirm = () => true;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  const fakeFetch = async (url, opts) => {
    const u = new URL(url, 'https://reckon.test'); const m = (opts && opts.method) || 'GET';
    const json = (b, s) => ({ ok: (s || 200) < 400, status: s || 200, json: async () => b });
    if (u.pathname === '/api/auth/me') return json({ user });
    if (u.pathname === '/api/kept/bootstrap') {
      if (gateBootstrap) await gate;
      if (bootstrapFails) return json({ error: 'D1 is having a moment' }, 500);
      return json({ profile, categories: cats, ai: false, emis: [], rules: [], transactions: serverRows, posted: { ran: false }, today: '2026-10-13' });
    }
    if (u.pathname === '/api/kept/profile') return json({ ok: true, profile });
    if (u.pathname === '/api/kept/transactions' && m === 'POST') { const b = JSON.parse(opts.body); return json({ ok: true, added: 1, transaction: row('ktx_9', b.d, b.descr, b.amount_minor, b.cat) }, 201); }
    return json({ error: 'no route' }, 404);
  };
  installApi(window, fakeFetch);
  for (const f of ['assets/js/global.js', 'kept/kept-engine.js', 'kept/kept-core.js', 'kept/kept-import.js']) window.eval(readFileSync(resolve(ROOT, f), 'utf8'));
  window.KeptStore = {
    read: async (id) => store.data[id] || null,
    write: async (id, snap) => { store.writes++; store.data[id] = snap; },
    clear: async () => { store.data = {}; }
  };
  window.eval(readFileSync(resolve(ROOT, 'kept/kept.js'), 'utf8'));
  return { window, d: window.document, release, store };
}

await t('with a snapshot the home screen is drawn before bootstrap answers', async () => {
  const p = boot({ snapshot: { profile, categories: cats, ai: false, emis: [], rules: [], transactions: snapRows, savedAt: 'x' }, gateBootstrap: true });
  await tick(30);
  eq(p.d.querySelector('#kp-loading').hidden, true, 'skeleton gone');
  ok(p.d.querySelector('#home-wrap .kp-hero'), 'hero drawn from the snapshot');
  eq(p.window.KEPT.state.rows.length, 3); eq(p.window.KEPT.state.fromCache, true);
  p.release(); await tick(30);
  eq(p.window.KEPT.state.rows.length, 4, 'server rows replaced the snapshot'); eq(p.window.KEPT.state.fromCache, false);
  await tick(200);   // the store write is debounced
  ok(p.store.writes >= 1, 'the fresh payload was written back to the store');
  eq(p.d.querySelectorAll('#home-wrap .kp-tx').length, 4);
});
await t('without a snapshot the skeleton shows until bootstrap answers; the payload is then stored', async () => {
  const p = boot({ gateBootstrap: true });
  await tick(30);
  eq(p.d.querySelector('#kp-loading').hidden, false);
  p.release(); await tick(30);
  eq(p.d.querySelector('#kp-loading').hidden, true); eq(p.window.KEPT.state.rows.length, 4);
  await tick(200);
  ok(p.store.data.usr_s && p.store.data.usr_s.transactions.length === 4, 'snapshot written');
});
await t('if the refresh fails the snapshot stays on screen with a message, not an error page', async () => {
  const p = boot({ snapshot: { profile, categories: cats, ai: false, emis: [], rules: [], transactions: snapRows, savedAt: 'x' }, bootstrapFails: true });
  await tick(60);
  eq(p.window.KEPT.state.rows.length, 3); ok(p.d.querySelector('#home-wrap .kp-hero'));
  ok(/last copy on this device/.test(p.d.querySelector('#toast-region').textContent));
});
await t('a snapshot that belongs to another account is not shown', async () => {
  const p = boot({ snapshot: null, gateBootstrap: true });
  p.store.data.usr_other = { profile, categories: cats, ai: false, emis: [], rules: [], transactions: snapRows, savedAt: 'x' };
  await tick(30);
  eq(p.d.querySelector('#kp-loading').hidden, false, 'nothing drawn for a different id');
  p.release();
});
await t('an added entry is on screen before the server answers and the snapshot follows the state', async () => {
  const p = boot({});
  await tick(60);
  const before = p.store.writes;
  p.window.KEPT.openAdd(); await tick(80);
  p.d.querySelector('#as-amt').value = '12.5'; p.d.querySelector('#as-desc').value = 'TEA';
  p.d.querySelector('#as-form').dispatchEvent(new p.window.Event('submit', { cancelable: true }));
  // Synchronously after submit: the provisional row is already in state.
  ok(p.window.KEPT.state.rows.some((r) => r.pending && r.descr === 'TEA'), 'provisional row');
  await tick(60);
  ok(!p.window.KEPT.state.rows.some((r) => r.pending), 'settled'); ok(p.window.KEPT.state.rows.some((r) => r.id === 'ktx_9'));
  await tick(200);
  ok(p.store.writes > before, 'snapshot rewritten after the write');
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
