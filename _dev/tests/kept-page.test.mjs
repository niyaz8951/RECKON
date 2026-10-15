/* KEPT page in jsdom: the real index.html with global.js, the engine, the
   importer and kept.js, over a stubbed fetch that keeps an in-memory ledger
   with the same dedupe rule as the server. Walks every tab, opens the add
   sheet, adds an entry twice (one row), edits it, records an EMI, and checks
   the chrome: the fab exists, every data-icon resolves, both themes render.
   Sample data invented. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

/* ------------------------------------------------- in-memory API */
const user = { id: 'usr_t', email: 'test@example.com', name: 'Tester', role: 'user', status: 'active', plan: 'member' };
// The same default list the server seeds, so the page sees real icon names.
import { createRequire } from 'node:module';
import { installApi } from './_stub-api.mjs';
const KC = createRequire(import.meta.url)(resolve(ROOT, 'kept/kept-core.js'));
const { DEFAULT_CATEGORIES } = KC;
// The real findings engine, so the page is tested against what the server sends.
const { computeFindings } = KC;
const analysisNow = () => ({ findings: computeFindings({ rows: live(), emis: db.emis, rules: db.rules, prof: db.profile }), narration: null, stale: true });
const cats = DEFAULT_CATEGORIES.map((c, i) => ({ id: 'kcat_' + i, ...c, sort: i }));
const db = { profile: { id: 'kprf_1', currency: 'AED', target_keep_bp: 2000, ramp_months: 6, profile_json: { age: 32, retireAge: 60, ret: 7, infl: 3, nw: 0, kids: [], majors: [], kidCost: 25000000, name: '' } }, tx: [], emis: [], rules: [], budgets: [], insights: [], calls: [] };
let seq = 0;
function hash(d, a, s) { const x = d + '|' + Math.round(a) + '|' + String(s || '').slice(0, 60); let h = 5381; for (let i = 0; i < x.length; i++) h = ((h << 5) + h + x.charCodeAt(i)) | 0; return 't' + (h >>> 0).toString(36); }
function live() { return db.tx.filter((r) => !r.deleted_at); }
function merge(r, source) {
  const h = hash(r.d, r.amount_minor, r.descr), cur = db.tx.find((x) => x.hash === h);
  if (cur) { cur.cat = r.cat || 'Misc'; cur.remark = r.remark || ''; cur.deleted_at = null; return { added: 0, updated: 1, transaction: cur }; }
  const row = { id: 'ktx_' + (++seq), d: r.d, descr: r.descr, amount_minor: Math.round(r.amount_minor), currency: 'AED', cat: r.cat || 'Misc', remark: r.remark || '', hash: h, source, status: 'approved', deleted_at: null };
  db.tx.push(row); db.tx.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)); return { added: 1, updated: 0, transaction: row };
}
// Seed four invented months so the review screens have something to show.
for (const ym of ['2026-06', '2026-07', '2026-08', '2026-09']) {
  merge({ d: ym + '-01', descr: 'SALARY — ACME', amount_minor: 1000000, cat: 'Income' }, 'import');
  merge({ d: ym + '-03', descr: 'GREENVIEW RENT', amount_minor: -300000, cat: 'Rent' }, 'import');
  merge({ d: ym + '-05', descr: 'CITY HYPERMARKET', amount_minor: -42000, cat: 'Grocery' }, 'import');
  merge({ d: ym + '-12', descr: 'CITY HYPERMARKET', amount_minor: -38000, cat: 'Grocery' }, 'import');
  merge({ d: ym + '-18', descr: 'SUNRISE CAFETERIA', amount_minor: -1400, cat: 'Food' }, 'import');
}
function json(body, status) { return { ok: (status || 200) < 400, status: status || 200, json: async () => body }; }
async function fakeFetch(url, opts) {
  const u = new URL(url, 'https://reckon.test'); const m = (opts && opts.method) || 'GET'; const b = opts && opts.body ? JSON.parse(opts.body) : {};
  db.calls.push(m + ' ' + u.pathname + u.search);
  const p = u.pathname;
  if (p === '/api/auth/me') return json({ user });
  if (p === '/api/kept/bootstrap') return json({ profile: db.profile, categories: cats, ai: false, emis: db.emis, rules: db.rules, transactions: live(), posted: { added: 0, updated: 0, skipped: 0, ran: false }, today: new Date().toISOString().slice(0, 10), analysis: analysisNow() });
  if (p === '/api/kept/analysis') return json({ ...analysisNow(), ai: false });
  if (p === '/api/kept/profile') { if (m === 'PUT') { Object.assign(db.profile, { currency: b.currency || db.profile.currency, target_keep_bp: b.target_keep_bp || db.profile.target_keep_bp, ramp_months: b.ramp_months || db.profile.ramp_months }); Object.assign(db.profile.profile_json, b.profile_json || {}); } return json({ profile: db.profile, categories: cats, ai: false }); }
  if (p === '/api/kept/emis') {
    if (m === 'POST') db.emis.push({ id: 'kemi_' + (++seq), name: b.name, lender: b.lender, emi_minor: b.emi_minor, currency: 'AED', total_n: b.total_n, due_day: +b.next_due.slice(8, 10), start_month: b.next_due.slice(0, 7), apr_bp: b.apr_bp, auto_post: 1 });
    if (m === 'DELETE') db.emis = db.emis.filter((e) => e.id !== u.searchParams.get('id'));
    return json({ emis: db.emis, posted: { added: 0 } }, m === 'POST' ? 201 : 200);
  }
  if (p === '/api/kept/recurring') {
    if (m === 'POST') db.rules.push({ id: 'krec_' + (++seq), descr: b.descr, amount_minor: b.amount_minor, cat: b.cat, freq: b.freq, start_d: b.start_d, end_d: b.end_d || null });
    if (m === 'DELETE') db.rules = db.rules.filter((r) => r.id !== u.searchParams.get('id'));
    return json({ rules: db.rules, posted: { added: 0 } }, m === 'POST' ? 201 : 200);
  }
  if (p === '/api/kept/transactions') {
    if (m === 'GET') return json({ transactions: live(), total: live().length });
    if (m === 'POST') { const r = merge(b, 'user'); return json({ ok: true, ...r }, r.added ? 201 : 200); }
    if (m === 'PUT') { const old = db.tx.find((x) => x.id === b.id); if (!old) return json({ error: 'Not found.' }, 404); const nx = { ...old, ...b }; const h = hash(nx.d, nx.amount_minor, nx.descr);
      if (h === old.hash) { old.cat = nx.cat; old.remark = nx.remark; return json({ ok: true, transaction: old, replaced: false }); }
      old.deleted_at = 'now'; const r = merge(nx, 'user'); r.transaction.supersedes_id = old.id; return json({ ok: true, transaction: r.transaction, replaced: true }); }
    if (m === 'DELETE') { const old = db.tx.find((x) => x.id === u.searchParams.get('id')); if (!old || old.deleted_at) return json({ error: 'Not found.' }, 404); old.deleted_at = 'now'; return json({ ok: true }); }
  }
  if (p === '/api/kept/budgets') { if (m === 'PUT') db.budgets.push({ id: 'kbud_' + (++seq), month: b.month, cat: b.cat, amount_minor: b.amount_minor, source: 'user', status: 'approved' }); return json({ month: u.searchParams.get('month'), budgets: db.budgets }); }
  if (p === '/api/kept/ai') { if (m === 'POST') return json({ error: 'AI is not configured on this deployment (no AI binding).' }, 503); return json({ insights: db.insights, ai: false }); }
  if (p === '/api/kept/import') return json({ ok: true, preview: { rows: (b.rows || []).length, collapsed: 0, invalid: 0, from: '', to: '' }, written: !!b.confirm, added: (b.rows || []).length, updated: 0, replaced: 0 });
  return json({ error: 'no route ' + p }, 404);
}

/* ----------------------------------------------------- the page */
const html = readFileSync(resolve(ROOT, 'kept/index.html'), 'utf8');
const vc = new VirtualConsole();
const consoleErrors = [];
vc.on('jsdomError', (e) => { if (!/Not implemented/.test(String(e && e.message))) consoleErrors.push(String(e && e.message)); });
vc.on('error', (m) => consoleErrors.push(String(m)));
const dom = new JSDOM(html, { url: 'https://reckon.test/kept/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
installApi(window, fakeFetch);
window.scrollTo = () => {};
window.confirm = () => true;
window.Chart = class { constructor() { window.__charts = (window.__charts || 0) + 1; } destroy() {} }; window.Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } };
window.XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: () => ({}), book_append_sheet: () => {} }, writeFile: (wb, name) => { window.__downloaded = name; } };
window.HTMLCanvasElement.prototype.getContext = () => null;
for (const f of ['assets/js/global.js', 'kept/kept-engine.js', 'kept/kept-core.js', 'kept/kept-store.js', 'kept/kept-import.js', 'kept/kept.js']) window.eval(readFileSync(resolve(ROOT, f), 'utf8'));

const ready = new Promise((r) => window.document.addEventListener('kept:ready', r, { once: true }));
await Promise.race([ready, tick(4000).then(() => { throw new Error('kept:ready never fired'); })]);
const d = window.document, $ = (s) => d.querySelector(s), $$ = (s) => [...d.querySelectorAll(s)];
const visible = () => $$('.kp-screen').filter((s) => !s.hidden).map((s) => s.getAttribute('data-screen'));

await t('page boots signed in, chrome mounted, body carries has-app-bar', async () => {
  ok($('.site-header .brand'), 'header'); ok($('.tab-bar'), 'hub tab bar mounted'); ok(d.body.classList.contains('has-app-bar'));
  eq(d.documentElement.getAttribute('data-app'), 'kept'); eq($('#kp-loading').hidden, true);
  eq(window.KEPT.state.rows.length, 20);
});
await t('the fab exists in the app bar and every data-icon resolved to an SVG', async () => {
  const fab = $('#kp-bar .app-bar__fab'); ok(fab); ok(fab.querySelector('svg'));
  eq($$('[data-icon]').length, 0, 'placeholders replaced'); ok($$('#kp-bar svg').length >= 5);
});
await t('icons used by the page exist in the registry (no square fallbacks)', async () => {
  const g = readFileSync(resolve(ROOT, 'assets/js/global.js'), 'utf8');
  const have = new Set([...g.slice(g.indexOf('var P ='), g.indexOf('\n  };', g.indexOf('var P ='))).matchAll(/^\s{4}'?([a-zA-Z0-9-]+)'?:/gm)].map((m) => m[1]));
  for (const m of html.matchAll(/data-icon="([a-z0-9-]+)"/g)) ok(have.has(m[1]), 'missing icon ' + m[1]);
  for (const c of cats) ok(have.has(c.icon), 'missing category icon ' + c.icon);
  const common = readFileSync(resolve(ROOT, 'kept/kept-core.js'), 'utf8');
  for (const m of common.matchAll(/icon: '([a-z-]+)'/g)) ok(have.has(m[1]), 'missing seeded icon ' + m[1]);
});
await t('home shows the hero with kept-so-far, the path card and recent rows', async () => {
  eq(visible().join(), 'home'); ok($('#home-wrap .kp-hero')); ok($('#home-wrap .kp-hero__big').textContent.includes('AED'));
  ok($$('#home-wrap .kp-tx').length === 5); ok($('#kp-rate b').textContent.includes('%'));
  ok($('#home-wrap [data-go="insights:health"]'), 'path card');
});
await t('every tab in the app bar opens its screen and sets aria-current', async () => {
  for (const name of ['spend', 'emis', 'insights', 'home']) {
    // Home from another tab is a history.back(): jsdom traverses on a later task.
    $('#kp-bar [data-screen="' + name + '"]').click(); await tick(30);
    eq(visible().join(), name); eq($('#kp-bar [aria-current="page"]').getAttribute('data-screen'), name); eq($('#kp-title').textContent, { spend: 'Spend', emis: 'EMIs', insights: 'Insights', home: 'Home' }[name]);
  }
});
await t('navigation works like a phone app: tabs sit over Home, pushed pages go back where they came from', async () => {
  $('#kp-bar [data-screen="home"]').click(); await tick(30);
  eq(window.location.hash, '#home');
  $('#kp-bar [data-screen="spend"]').click(); await tick(30);
  eq(window.location.hash, '#spend'); eq(window.history.state.back, '#home');
  $('#kp-bar [data-screen="emis"]').click(); await tick(30);
  eq(window.location.hash, '#emis'); eq(visible().join(), 'emis');
  window.history.back(); await tick(30);
  eq(visible().join(), 'home', 'back from any tab returns to Home');
  $('#kp-bar [data-screen="spend"]').click(); await tick(30);
  $('[data-screen="spend"] [data-go="history"]').click(); await tick(30);
  eq(visible().join(), 'history'); ok(d.body.classList.contains('is-pushed'), 'a pushed page');
  eq(window.history.state.back, '#spend');
  $('[data-screen="history"] [data-back]').click(); await tick(30);
  eq(visible().join(), 'spend', 'the back bar returns to Spend'); ok(!d.body.classList.contains('is-pushed'));
  $('#kp-bar [data-screen="home"]').click(); await tick(30);
  eq(window.location.hash, '#home');
});
await t('spend: month chips, category rows, drill-down, merchants, and the link to history', async () => {
  $('#kp-bar [data-screen="spend"]').click(); await tick(30);
  ok($$('#spend-chips button').length >= 5); eq($('#spend-chips button').getAttribute('aria-selected'), 'true', 'newest period selected first');
  ok($$('#cat-list [data-c]').length >= 2); ok($$('#merchants .kp-catrow').length >= 2);
  $('#cat-list [data-c="Grocery"]').click(); await tick();
  ok($('#cat-list .kp-drill'), 'drill-down opened'); ok($$('#cat-list .kp-drill .kp-tx').length >= 1);
  $('[data-screen="spend"] [data-go="history"]').click(); await tick();
  eq(visible().join(), 'history'); eq($('#kp-bar [aria-current="page"]').getAttribute('data-screen'), 'spend', 'history keeps Spend lit');
  ok($$('#hx-list .kp-tx').length === 20); ok($$('#hx-month option').length >= 5);
  $('#hx-search').value = 'cafeteria'; $('#hx-search').dispatchEvent(new window.Event('input')); await tick();
  eq($$('#hx-list .kp-tx').length, 4);
  $('#hx-search').value = ''; $('#hx-search').dispatchEvent(new window.Event('input'));
});
await t('the fab opens the add sheet; adding the same entry twice yields one row', async () => {
  $('#kp-bar [data-screen="home"]').click(); await tick(30);
  const before = window.KEPT.state.rows.length;
  $('#kp-fab').click(); await tick(80);
  ok($('#add-sheet').hasAttribute('open'), 'sheet open'); eq($('#as-title').textContent, 'Add an entry');
  ok($$('#as-cats .kp-catbtn').length >= 10, 'category grid'); eq($('#as-save').textContent, 'Save expense');
  $('#as-cats [data-c="Food"]').click();
  $('#as-amt').value = '14.50'; $('#as-desc').value = 'SUNRISE CAFETERIA'; $('#as-date').value = '2026-10-02';
  $('#as-form').dispatchEvent(new window.Event('submit', { cancelable: true })); await tick(30);
  eq(window.KEPT.state.rows.length, before + 1); ok(!$('#add-sheet').hasAttribute('open'), 'sheet closed');
  const row = window.KEPT.state.rows.find((r) => r.d === '2026-10-02'); eq(row.amount_minor, -1450); eq(row.cat, 'Food');
  $('#kp-fab').click(); await tick(80);
  $('#as-cats [data-c="Grocery"]').click();
  $('#as-amt').value = '14.50'; $('#as-desc').value = 'SUNRISE CAFETERIA'; $('#as-date').value = '2026-10-02';
  $('#as-form').dispatchEvent(new window.Event('submit', { cancelable: true })); await tick(30);
  eq(window.KEPT.state.rows.length, before + 1, 'same date+amount+description replaced in place');
  eq(window.KEPT.state.rows.find((r) => r.d === '2026-10-02').cat, 'Grocery', 'newer category wins');
  ok($('#toast-region .toast'), 'a toast confirmed the save');
});
await t('tapping a row opens the sheet in edit mode; changing the amount supersedes the row', async () => {
  const row = window.KEPT.state.rows.find((r) => r.d === '2026-10-02');
  $('#home-wrap .kp-tx[data-id="' + row.id + '"]').click(); await tick(80);
  eq($('#as-title').textContent, 'Edit entry'); eq($('#as-amt').value, '14.5'); eq($('#as-del').hidden, false);
  $('#as-amt').value = '15'; $('#as-form').dispatchEvent(new window.Event('submit', { cancelable: true })); await tick(30);
  const after = window.KEPT.state.rows.find((r) => r.d === '2026-10-02');
  eq(after.amount_minor, -1500); ok(after.id !== row.id); eq(after.supersedes_id, row.id);
  eq(window.KEPT.state.rows.filter((r) => r.d === '2026-10-02').length, 1);
});
await t('received mode and paste-SMS mode switch the sheet', async () => {
  $('#kp-fab').click(); await tick(80);
  $('#as-seg [data-m="in"]').click(); eq($('#as-save').textContent, 'Save income'); ok($$('#as-cats .kp-catbtn').length === 4);
  $('#as-seg [data-m="sms"]').click(); eq($('#as-manual').hidden, true); eq($('#as-sms').hidden, false);
  $('#as-paste').value = 'AED 42.00 spent at CITY HYPERMARKET on 03/10/26';
  const before = window.KEPT.state.rows.length;
  $('#as-form').dispatchEvent(new window.Event('submit', { cancelable: true })); await tick(30);
  eq(window.KEPT.state.rows.length, before + 1);
  const r = window.KEPT.state.rows.find((x) => x.remark === 'sms'); eq(r.amount_minor, -4200); eq(r.cat, 'Grocery'); eq(r.d, '2026-10-03');
});
await t('EMIs: the sheet records a loan and the screen draws rings, timeline and payoff', async () => {
  $('#kp-bar [data-screen="emis"]').click(); await tick(30);
  ok($('#emi-add0'), 'empty state');
  $('#emi-add0').click(); await tick(80);
  ok($('#emi-sheet').hasAttribute('open'));
  $('#em-name').value = 'Car loan'; $('#em-amt').value = '850'; $('#em-total').value = '48'; $('#em-paid').value = '10'; $('#em-next').value = '2026-11-05'; $('#em-apr').value = '4.5';
  $('#em-amt').dispatchEvent(new window.Event('input')); ok($('#em-preview').textContent.includes('38 instalments left'));
  $('#em-form').dispatchEvent(new window.Event('submit', { cancelable: true })); await tick(30);
  eq(window.KEPT.state.emis.length, 1); ok(!$('#emi-sheet').hasAttribute('open'));
  ok($$('#emi-wrap .kp-emicard').length === 1); ok($('#emi-wrap .kp-ring')); ok($$('#emi-wrap .kp-tl > div').length === 38 || $$('#emi-wrap .kp-tl > div').length === 36);
  ok($('#pay-cmp .kp-row'), 'payoff comparison');
  ok($('#emi-wrap .kp-emicard .kp-ring__c b').textContent.trim().length > 0);
  // the home EMI snapshot now shows the loan
  $('#kp-bar [data-screen="home"]').click(); await tick(30);
  ok($('#home-wrap .kp-emimini'), 'EMI snapshot on home');
});
await t('recurring rule sheet saves a rule and lists it', async () => {
  $('#kp-bar [data-screen="emis"]').click(); await tick(30);
  $('#rc-open').click(); await tick(80);
  $('#rc-amt').value = '3000'; $('#rc-desc').value = 'Rent'; $('#rc-cat').value = 'Rent'; $('#rc-start').value = '2026-01-03';
  $('#rc-form').dispatchEvent(new window.Event('submit', { cancelable: true })); await tick(30);
  eq(window.KEPT.state.rules.length, 1); ok($('#rc-list .kp-catrow')); ok($('#rc-list').textContent.includes('Rent'));
});
await t('insights: each tile opens as its own page with the hub hidden; back returns to the hub', async () => {
  $('#kp-bar [data-screen="insights"]').click(); await tick(30);
  ok($$('#ins-hub [data-ins]').length === 8, 'analysis + 5 reviews + 2 tools');
  ok($('#ins-hub .kp-ana-tile'), 'the analysis tile leads the hub');
  for (const k of ['health', 'cfo', 'mom', 'forecast', 'life']) {
    $('#ins-hub [data-ins="' + k + '"]').click(); await tick(30);
    eq($('#ins-hub').hidden, true, k + ': hub hidden'); eq($('#ins-view').hidden, false); ok($('#ins-body').children.length > 0, k + ' rendered');
    ok(d.body.classList.contains('is-pushed')); eq(window.location.hash, '#insights:' + k);
    eq($('#ins-title').textContent.length > 0, true);
    $('#ins-back').click(); await tick(30);
    eq($('#ins-hub').hidden, false); eq($('#ins-view').hidden, true); eq(window.location.hash, '#insights', 'the view left the history too');
  }
  ok(!$('#ins-hub [data-ins="ai-ask"]') && !$('#ins-hub [data-ins="ai-budget"]'), 'the AI tools are gone');
  $('#ins-hub [data-ins="upcoming"]').click(); await tick(30);
  ok($('#up-det table'), 'the upcoming list renders'); ok($('#up-det').textContent.includes('Car loan EMI'));
  $('#ins-back').click(); await tick(30);
  $('#ins-hub [data-ins="categorise"]').click(); await tick(30);
  eq($('#ins-title').textContent, 'Categorise');
  $('#ins-back').click(); await tick(30);
  ok(!$('#ins-hub [data-ins="settings"]'), 'settings moved to Account');
  ok(!$('[data-screen="settings"]'), 'no settings screen in the app');
});
await t('analysis: findings render with facts, a why and a step; "Got it" hides one until its figures change', async () => {
  $('#ins-hub [data-ins="analysis"]').click(); await tick(60);
  eq($('#ins-view').hidden, false); eq($('#ins-title').textContent, 'What KEPT noticed');
  const cards = $$('#ins-body .kp-find');
  ok(cards.length >= 2, 'findings from the invented ledger');
  eq($$('#ins-body .kp-find.is-seen').length, 0, 'none rendered as seen');
  const c = cards[0];
  ok(c.querySelector('.kp-find__facts li'), 'facts'); ok(c.querySelector('.kp-find__why').textContent.length > 20, 'why');
  ok(/Do this:/.test(c.querySelector('.kp-find__act').textContent), 'action');
  ok(!/\bAI\b|model/.test($('#ins-body').textContent), 'no AI anywhere on the analysis page');
  const before = cards.length;
  c.querySelector('[data-dismiss]').click(); await tick(40);
  eq($$('#ins-body .kp-find:not(.is-seen)').length, before - 1, 'one fewer');
  ok(Object.keys(db.profile.profile_json.dismissed || {}).length === 1, 'saved on the profile');
  $('#ana-seen').click(); await tick(10);
  ok($('#ins-body .kp-find.is-seen [data-undo]'), 'can bring it back');
  $('#ins-body .kp-find.is-seen [data-undo]').click(); await tick(40);
  eq(Object.keys(db.profile.profile_json.dismissed || {}).length, 0);
  $('#ins-back').click(); await tick(30);
});
await t('home carries the "What KEPT noticed" card, and it opens the analysis page', async () => {
  $('#kp-bar [data-screen="home"]').click(); await tick(30);
  const card = $('#home-wrap .kp-ana-home');
  ok(card, 'card on Home'); ok(card.querySelectorAll('.kp-ana-mini li').length >= 1);
  card.click(); await tick(30);
  eq(visible().join(), 'insights'); eq($('#ins-title').textContent, 'What KEPT noticed');
  $('#ins-back').click(); await tick(30);
});
await t('export from Transactions still calls SheetJS (loaded on demand)', async () => {
  $('#kp-bar [data-screen="spend"]').click(); await tick(30);
  $('[data-screen="spend"] [data-go="history"]').click(); await tick(30);
  $('#hx-export').click(); await tick(); ok(/^Kept_Export_/.test(window.__downloaded));
});
await t('charts were asked for (Chart.js constructed) and no console errors leaked', async () => {
  ok(window.__charts > 0, 'Chart constructed'); eq(consoleErrors.length, 0, consoleErrors.join(' | '));
});
await t('dark theme re-renders without errors', async () => {
  d.documentElement.setAttribute('data-theme', 'dark'); await tick(30);
  $('#kp-bar [data-screen="home"]').click(); await tick(30);
  ok($('#home-wrap .kp-hero')); eq(consoleErrors.length, 0, consoleErrors.join(' | '));
});
await t('the page only ever talked to /api/auth/me and /api/kept/*', async () => {
  for (const c of db.calls) ok(/^(GET|POST|PUT|DELETE|PATCH) \/api\/(auth\/me|kept\/)/.test(c), c);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
