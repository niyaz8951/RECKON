/* KEPT settings (/kept/settings/): loads from bootstrap, saves each field as
   it changes (and refuses out-of-range values), runs the sample and export
   through SheetJS, and an upload replaces the record only after the
   confirmation sheet — then drops the on-device snapshot. Invented data. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { installApi } from './_stub-api.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

const profile = { currency: 'AED', target_keep_bp: 2000, ramp_months: 6, profile_json: {} };
const rows = [{ id: 'ktx_1', d: '2026-08-01', descr: 'SALARY', amount_minor: 900000, cat: 'Income' }, { id: 'ktx_2', d: '2026-09-03', descr: 'RENT', amount_minor: -300000, cat: 'Rent' }];
const calls = [];
const html = readFileSync(resolve(ROOT, 'kept/settings/index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://reckon.test/kept/settings/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, d = w.document, $ = (s) => d.querySelector(s);
w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
w.scrollTo = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
const fakeFetch = async (url, opts) => {
  const u = new URL(url, 'https://reckon.test'), m = (opts && opts.method) || 'GET', b = opts && opts.body ? JSON.parse(opts.body) : null;
  calls.push(m + ' ' + u.pathname + (b && 'confirm' in b ? ' confirm=' + b.confirm : ''));
  const json = (x, s) => ({ ok: (s || 200) < 400, status: s || 200, json: async () => x });
  if (u.pathname === '/api/auth/me') return json({ user: { id: 'usr_a', email: 'a@example.com', name: 'A', role: 'user', status: 'active' } });
  if (u.pathname === '/api/kept/bootstrap') return json({ profile, transactions: rows, ai: true, categories: [], emis: [], rules: [] });
  if (u.pathname === '/api/kept/profile' && m === 'PUT') { Object.assign(profile, b); return json({ ok: true, profile }); }
  if (u.pathname === '/api/kept/import') return json({ ok: true, preview: { rows: 3, collapsed: 0, invalid: 0, from: '2026-01-01', to: '2026-01-03' }, added: 3, updated: 0 });
  return json({ error: 'no route' }, 404);
};
let cleared = 0;
w.XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: () => ({}), book_append_sheet: () => {} }, writeFile: (wb, name) => { w.__downloaded = name; } };
installApi(w, fakeFetch);
for (const f of ['assets/js/global.js', 'kept/kept-store.js', 'kept/kept-import.js', 'kept/kept-settings.js']) w.eval(readFileSync(resolve(ROOT, f), 'utf8'));
w.KeptStore.clear = async () => { cleared++; };
const ready = new Promise((r) => d.addEventListener('kept-settings:ready', r, { once: true }));
await Promise.race([ready, tick(3000)]);
await tick(20);

await t('the page loads under Account with a back bar, the KEPT accent and the current values', async () => {
  eq($('#ks-body').hidden, false); eq($('#ks-loading').hidden, true);
  eq(new URL($('.nav-bar__back').getAttribute('href'), w.location.href).pathname, '/account/'); eq(d.documentElement.getAttribute('data-app'), 'kept');
  ok(d.body.classList.contains('is-pushed'), 'one bar on a phone');
  eq($('#set-cur').value, 'AED'); eq($('#set-target').value, '20'); eq($('#set-ramp').value, '6');
  ok(/2<\/b> transactions/.test($('#data-info').innerHTML)); ok(!d.querySelector('#ai-status'), 'no AI row');
});
await t('each field saves as it changes; out-of-range values are refused and put back', async () => {
  $('#set-target').value = '25'; $('#set-target').dispatchEvent(new w.Event('change')); await tick(20);
  eq(profile.target_keep_bp, 2500); ok(cleared >= 1, 'KEPT snapshot dropped so the app refetches');
  $('#set-cur').value = 'INR'; $('#set-cur').dispatchEvent(new w.Event('change')); await tick(20);
  eq(profile.currency, 'INR');
  const n = calls.length;
  $('#set-ramp').value = '99'; $('#set-ramp').dispatchEvent(new w.Event('change')); await tick(20);
  eq(calls.length, n, 'no request for a bad value'); eq($('#set-ramp').value, '6', 'put back');
});
await t('sample and export go through SheetJS', async () => {
  $('#data-sample').click(); await tick(); eq(w.__downloaded, 'Kept_Sample.xlsx');
  $('#data-export').click(); await tick(); ok(/^Kept_Export_/.test(w.__downloaded));
});
await t('an upload previews first, replaces only on confirm, then drops the snapshot', async () => {
  w.KeptImport.readFile = async () => ({ rows: [{ d: '2026-01-01', descr: 'X', amount_minor: -100, cat: 'Misc' }], mapping: { date: 'Date', amount: 'Amount' }, skipped: 0 });
  const before = cleared;
  const input = $('#data-file');
  Object.defineProperty(input, 'files', { value: [new w.File(['x'], 'ledger.csv')], configurable: true });
  input.dispatchEvent(new w.Event('change')); await tick(30);
  ok($('#imp-sheet').hasAttribute('open'), 'confirmation sheet'); ok(calls.includes('POST /api/kept/import confirm=false'));
  ok(!calls.includes('POST /api/kept/import confirm=true'), 'nothing replaced yet');
  $('#imp-go').click(); await tick(40);
  ok(calls.includes('POST /api/kept/import confirm=true')); ok(!$('#imp-sheet').hasAttribute('open')); ok(cleared > before);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
