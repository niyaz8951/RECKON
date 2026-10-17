/* KEPT's data layer (kept/kept-data.js) against real Postgres: PGlite with
   supabase/schema.sql, every query run as the signed-in person with
   row-level security on. The same scenarios the Cloudflare functions were
   tested with — dedupe, supersede, soft delete, import, EMIs, recurring
   posting, bootstrap, budgets, profile — plus the isolation the database
   now enforces on its own. All data invented. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { freshDb, ROOT } from './_pg.mjs';

const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };

const S = await freshDb();
for (const f of ['assets/js/db.js', 'assets/js/routes-core.js', 'kept/kept-core.js', 'kept/kept-data.js']) require(resolve(ROOT, f));
const D = globalThis.TNData;
const admin = await S.signUp('owner@example.com', 'Owner');        // first account: active admin
const uid = await S.signUp('tester@example.com', 'Tester');        // pending until approved
await S.admin("update public.profiles set status = 'active' where id = $1", [uid]);
let current = uid;
const as = (id) => { current = id; D._use({ db: S.asUser(id), auth: { session: async () => (id ? { user: { id } } : null), signOut: async () => {} } }); };
as(uid);

async function call(route, method, { query = '', body = null } = {}) {
  try { return { status: 200, body: await D.handle(method, '/api/kept/' + route + (query ? '?' + query : ''), body) }; }
  catch (e) { return { status: e.status || 500, body: { error: e.message } }; }
}

/* ------------------------------------------------------- transactions */
await t('POST adds a transaction; the same date+amount+description updates in place', async () => {
  const a = await call('transactions', 'POST', { body: { d: '2026-03-04', descr: 'CITY HYPERMARKET', amount_minor: -42000, cat: 'Grocery' } });
  eq(a.body.added, 1); ok(a.body.transaction.id.startsWith('ktx_')); eq(a.body.transaction.kind, 'expense');
  const b = await call('transactions', 'POST', { body: { d: '2026-03-04', descr: 'CITY HYPERMARKET', amount_minor: -42000, cat: 'Food', remark: 'fixed' } });
  eq(b.body.updated, 1); eq(b.body.transaction.id, a.body.transaction.id); eq(b.body.transaction.cat, 'Food');
  const list = await call('transactions', 'GET', { query: 'all=1' });
  eq(list.body.total, 1);
});
await t('POST rejects a bad date and a zero amount', async () => {
  eq((await call('transactions', 'POST', { body: { d: '4/3/2026', descr: 'X', amount_minor: -1 } })).status, 400);
  eq((await call('transactions', 'POST', { body: { d: '2026-03-04', descr: 'X', amount_minor: 0 } })).status, 400);
});
let txId;
await t('PUT with only the category changed keeps the row; changing the amount supersedes it', async () => {
  const list = await call('transactions', 'GET', { query: 'all=1' });
  txId = list.body.transactions[0].id;
  const p1 = await call('transactions', 'PUT', { body: { id: txId, cat: 'Grocery' } });
  eq(p1.body.replaced, false); eq(p1.body.transaction.id, txId);
  const p2 = await call('transactions', 'PUT', { body: { id: txId, amount_minor: -43000 } });
  eq(p2.body.replaced, true); ok(p2.body.transaction.id !== txId); eq(p2.body.transaction.supersedes_id, txId); eq(p2.body.transaction.amount_minor, -43000);
  const after = await call('transactions', 'GET', { query: 'all=1' });
  eq(after.body.total, 1, 'the old row is hidden');
  txId = p2.body.transaction.id;
});
await t('DELETE soft-deletes; a second delete is 404; a user re-add revives the same row', async () => {
  eq((await call('transactions', 'DELETE', { query: 'id=' + txId })).status, 200);
  eq((await call('transactions', 'DELETE', { query: 'id=' + txId })).status, 404);
  eq((await call('transactions', 'GET', { query: 'all=1' })).body.total, 0);
  const re = await call('transactions', 'POST', { body: { d: '2026-03-04', descr: 'CITY HYPERMARKET', amount_minor: -43000, cat: 'Grocery' } });
  eq(re.body.updated, 1); eq(re.body.transaction.id, txId);
});
await t('GET filters by month, kind and search, and pages', async () => {
  await call('transactions', 'POST', { body: { d: '2026-03-01', descr: 'SALARY — ACME', amount_minor: 1000000, cat: 'Income' } });
  await call('transactions', 'POST', { body: { d: '2026-02-20', descr: 'PETROL — CITY FUEL', amount_minor: -17000, cat: 'Fuel' } });
  eq((await call('transactions', 'GET', { query: 'month=2026-03' })).body.total, 2);
  eq((await call('transactions', 'GET', { query: 'kind=income' })).body.total, 1);
  eq((await call('transactions', 'GET', { query: 'q=petrol' })).body.total, 1);
  const page = await call('transactions', 'GET', { query: 'limit=2&offset=1' });
  eq(page.body.transactions.length, 2); eq(page.body.total, 3);
  eq(page.body.transactions[0].d <= (await call('transactions', 'GET', { query: 'limit=1' })).body.transactions[0].d, true, 'newest first');
});

/* ------------------------------------------------------------- import */
await t('import without confirm previews and writes nothing', async () => {
  const r = await call('import', 'POST', { body: { rows: [
    { d: '2026-01-05', descr: 'A', amount_minor: -100 }, { d: '2026-01-05', descr: 'A', amount_minor: -100, cat: 'Food' }, { d: 'bad', descr: 'B', amount_minor: -5 }, { d: '2026-01-06', descr: 'C', amount_minor: 500 }] } });
  eq(r.body.written, false); eq(r.body.preview.rows, 2); eq(r.body.preview.collapsed, 1); eq(r.body.preview.invalid, 1);
  eq((await call('transactions', 'GET', { query: 'all=1' })).body.total, 3);
});
await t('import with confirm replaces the ledger and keeps source=import', async () => {
  const r = await call('import', 'POST', { body: { confirm: true, rows: [
    { d: '2026-01-05', descr: 'A', amount_minor: -100, cat: 'Food' }, { d: '2026-01-06', descr: 'C', amount_minor: 500 }, { d: '2026-03-04', descr: 'CITY HYPERMARKET', amount_minor: -43000, cat: 'Grocery' }] } });
  eq(r.body.written, true); eq(r.body.replaced, 3); eq(r.body.added + r.body.updated, 3);
  const list = await call('transactions', 'GET', { query: 'all=1' });
  eq(list.body.total, 3);
  ok(list.body.transactions.every((x) => x.source === 'import' || x.id === txId), 'new rows carry source=import');
  eq(list.body.transactions.find((x) => x.descr === 'A').source, 'import');
});

/* --------------------------------------------------------------- EMIs */
await t('EMI add derives start month from next due and paid count, and posts due instalments', async () => {
  const r = await call('emis', 'POST', { body: { name: 'Car loan', emi_minor: 85000, total_n: 48, paid_n: 10, next_due: '2026-02-05', apr_bp: 450 } });
  const e = r.body.emis[0];
  eq(e.start_month, '2025-04'); eq(e.due_day, 5); eq(e.derived.total_n, 48);
  // post_from is this month: only this month's instalment can be posted, and only once its due day has passed.
  eq(r.body.posted.added, new Date().getUTCDate() >= 5 ? 1 : 0, 'no back-dated instalments before post_from');
  const posted = (await call('transactions', 'GET', { query: 'q=car loan&all=1' })).body.transactions;
  posted.forEach((x) => { eq(x.source, 'system'); eq(x.remark, 'emi:' + e.id); eq(x.amount_minor, -85000); });
});
await t('EMI edit, derived next_due, and delete', async () => {
  const list = await call('emis', 'GET');
  const e = list.body.emis[0];
  const p = await call('emis', 'PUT', { body: { id: e.id, name: 'Car loan', lender: 'Bank', emi_minor: 85000, total_n: 48, paid_n: 10, next_due: '2026-02-05', apr_bp: 0 } });
  eq(p.body.emis[0].lender, 'Bank'); eq(p.body.emis[0].apr_bp, 0);
  eq((await call('emis', 'POST', { body: { name: '', emi_minor: 1, total_n: 1, next_due: '2026-02-05' } })).status, 400);
  const d = await call('emis', 'DELETE', { query: 'id=' + e.id });
  eq(d.body.emis.length, 0);
});

/* ---------------------------------------------------------- recurring */
await t('a recurring rule writes every past occurrence once, deduped on re-run', async () => {
  const start = new Date(); start.setUTCMonth(start.getUTCMonth() - 2); start.setUTCDate(1);
  const sd = start.toISOString().slice(0, 10);
  const r = await call('recurring', 'POST', { body: { descr: 'Rent', amount_minor: -300000, cat: 'Rent', freq: 'monthly', start_d: sd } });
  eq(r.body.posted.added, 3, 'this month and the two before');
  const again = await call('recurring', 'GET', { query: 'post=1' });
  eq(again.body.posted.added, 0); eq(again.body.posted.updated, 3);
  const today = await call('recurring', 'GET');
  eq(today.body.posted.ran, false, 'the job already ran today, so a plain GET skips it');
  const list = await call('transactions', 'GET', { query: 'q=rent&all=1' });
  eq(list.body.total, 3); ok(list.body.transactions.every((x) => x.source === 'system' && x.remark.startsWith('recurring:')));
  eq((await call('recurring', 'DELETE', { query: 'id=' + r.body.id })).status, 200);
});
await t('a deleted system row is not resurrected by the posting job', async () => {
  const start = new Date(); start.setUTCMonth(start.getUTCMonth() - 1); start.setUTCDate(2);
  const r = await call('recurring', 'POST', { body: { descr: 'Netflix', amount_minor: -3900, cat: 'Entertainment', freq: 'monthly', start_d: start.toISOString().slice(0, 10) } });
  const rows = (await call('transactions', 'GET', { query: 'q=netflix&all=1' })).body.transactions;
  eq(rows.length, 2);
  await call('transactions', 'DELETE', { query: 'id=' + rows[0].id });
  const again = await call('recurring', 'GET', { query: 'post=1' });
  eq(again.body.posted.skipped, 1);
  eq((await call('transactions', 'GET', { query: 'q=netflix&all=1' })).body.total, 1);
  await call('recurring', 'DELETE', { query: 'id=' + r.body.id });
});

/* ------------------------------------------------------------ bootstrap */
await t('bootstrap returns everything the page needs in one call, shaped like the four routes', async () => {
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 2);
  const nd = start.toISOString().slice(0, 10);
  const e = await call('emis', 'POST', { body: { name: 'Bike loan', emi_minor: 50000, total_n: 12, paid_n: 2, next_due: nd } });
  const r = await call('bootstrap', 'GET');
  eq(r.status, 200);
  ok(r.body.profile && r.body.profile.currency, 'profile'); ok(Array.isArray(r.body.categories) && r.body.categories.length > 5, 'categories');
  ok(Array.isArray(r.body.transactions), 'transactions'); ok(r.body.transactions.every((x) => x.kind), 'every row classified');
  const bike = r.body.emis.find((x) => x.name === 'Bike loan'); ok(bike && bike.derived && typeof bike.derived.left_n === 'number', 'emis carry derived figures');
  ok(Array.isArray(r.body.rules), 'rules'); eq(typeof r.body.ai, 'boolean'); ok(/^\d{4}-\d{2}-\d{2}$/.test(r.body.today));
  ok(r.body.posted && typeof r.body.posted.ran === 'boolean', 'posting job reported');
  const tx = await call('transactions', 'GET', { query: 'all=1' });
  eq(r.body.transactions.length, tx.body.total, 'same ledger as /transactions');
  await call('emis', 'DELETE', { query: 'id=' + e.body.id });
});
await t('the posting job runs at most once a day; postedOn is stamped on the profile', async () => {
  const first = await call('bootstrap', 'GET');
  const second = await call('bootstrap', 'GET');
  eq(second.body.posted.ran, false);
  eq(second.body.profile.profile_json.postedOn, new Date().toISOString().slice(0, 10));
  ok(first.body.profile.profile_json.postedOn === second.body.profile.profile_json.postedOn);
  const forced = await call('emis', 'GET', { query: 'post=1' });
  eq(forced.body.posted.ran, true);
});

/* -------------------------------------------------------------- profile */
await t('profile is created on first read with seeded categories; PUT merges profile_json', async () => {
  const g = await call('profile', 'GET');
  eq(g.body.profile.currency, 'AED'); eq(g.body.profile.target_keep_bp, 2000); ok(g.body.categories.length > 15); eq(g.body.ai, false, 'no AI on this site');
  const p = await call('profile', 'PUT', { body: { currency: 'INR', target_keep_bp: 2500, profile_json: { name: 'Tester', age: 40 } } });
  eq(p.body.profile.currency, 'INR'); eq(p.body.profile.profile_json.name, 'Tester'); eq(p.body.profile.profile_json.age, 40);
  const p2 = await call('profile', 'PUT', { body: { profile_json: { pathBase: { m: '2026-01', rate: 12 } } } });
  eq(p2.body.profile.profile_json.name, 'Tester', 'merge keeps other keys'); eq(p2.body.profile.profile_json.pathBase.m, '2026-01');
  eq((await call('profile', 'PUT', { body: { currency: 'XXX' } })).status, 400);
  eq((await call('profile', 'GET')).body.categories.length, g.body.categories.length, 'seeded once');
});

/* -------------------------------------------------------------- budgets */
await t('a user budget figure supersedes an older draft row and is edited in place afterwards', async () => {
  // Plant an AI draft directly, as ai.js would.
  await S.admin("insert into public.kept_budgets (id, user_id, month, cat, amount_minor, currency, source, status, created_at, updated_at) values ('kbud_ai1', $1, '2026-04', 'Food', 120000, 'INR', 'ai', 'draft', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z')", [uid]);
  const g = await call('budgets', 'GET', { query: 'month=2026-04' });
  eq(g.body.budgets.length, 1); eq(g.body.budgets[0].status, 'draft');
  const p = await call('budgets', 'PUT', { body: { month: '2026-04', cat: 'Food', amount_minor: 100000 } });
  eq(p.body.budgets.length, 1); eq(p.body.budgets[0].source, 'user'); eq(p.body.budgets[0].supersedes_id, 'kbud_ai1');
  const draft = (await S.admin("select status, amount_minor from public.kept_budgets where id = 'kbud_ai1'"))[0];
  eq(draft.amount_minor, 120000, 'the older row is untouched');
  const p2 = await call('budgets', 'PUT', { body: { month: '2026-04', cat: 'Food', amount_minor: 110000 } });
  eq(p2.body.budgets.length, 1); eq(p2.body.budgets[0].id, p.body.budgets[0].id); eq(p2.body.budgets[0].amount_minor, 110000);
  eq((await call('budgets', 'PUT', { body: { month: '2026-4', cat: 'Food', amount_minor: 1 } })).status, 400);
});

await t('profile: dismissed findings are kept as id → signature, cleaned and bounded', async () => {
  const many = {}; for (let i = 0; i < 100; i++) many['f' + i] = 's' + i;
  many.bad = 12; many['x'.repeat(200)] = 'y';
  const r = await call('profile', 'PUT', { body: { profile_json: { dismissed: many } } });
  eq(r.status, 200);
  const d = r.body.profile.profile_json.dismissed;
  eq(Object.keys(d).length, 80); ok(!('bad' in d)); ok(d.f99 === 's99', 'newest kept'); ok(!('f0' in d), 'oldest dropped');
  const r2 = await call('profile', 'PUT', { body: { profile_json: { dismissed: [] } } });
  eq(JSON.stringify(r2.body.profile.profile_json.dismissed), '{}');
});


/* ---------------------------------------------------- what the database enforces */
await t('patterns: one answer per payee; "reserved" keeps the day it started; undo removes the answer; bootstrap carries patterns and KEPT card feedback', async () => {
  let r = await call('patterns', 'PUT', { body: { key: 'AXA CAR INSURANCE', status: 'reserved', label: 'Axa Car Insurance', freq: 'yearly', amount_minor: -235000, next_d: '2026-11-12' } });
  eq(r.status, 200); eq(r.body.patterns.length, 1);
  const p = r.body.patterns[0];
  eq(p.status, 'reserved'); eq(p.amount_minor, 235000, 'stored positive'); ok(/^\d{4}-\d{2}-\d{2}$/.test(p.reserve_from));
  await S.admin("update public.kept_patterns set reserve_from = '2026-10-01' where key = 'AXA CAR INSURANCE'");
  r = await call('patterns', 'PUT', { body: { key: 'AXA CAR INSURANCE', status: 'reserved', next_d: '2026-11-12', amount_minor: 235000 } });
  eq(r.body.patterns[0].reserve_from, '2026-10-01', 'saying yes again does not restart the set-aside');
  r = await call('patterns', 'PUT', { body: { key: 'GEMS SCHOOL FEES', status: 'dismissed' } });
  eq(r.body.patterns.length, 2); eq(r.body.patterns[1].reserve_from, null);
  eq((await call('patterns', 'PUT', { body: { key: 'X', status: 'maybe' } })).status, 400);
  eq((await call('patterns', 'PUT', { body: { key: 'X', status: 'confirmed', next_d: '12/11/2026' } })).status, 400);
  r = await call('patterns', 'DELETE', { query: 'key=' + encodeURIComponent('GEMS SCHOOL FEES') });
  eq(r.body.patterns.length, 1);
  await D.handle('POST', '/api/cards/feedback', { app: 'kept', type: 'heads-up', card_key: 'AXA CAR INSURANCE', verdict: 'shown', d: '2026-10-17' });
  eq((await D.handle('POST', '/api/cards/feedback', { app: 'kept', type: 'heads-up', card_key: 'AXA CAR INSURANCE', verdict: 'shown', d: '2026-10-17' })).already, true, 'shown once a day');
  await D.handle('POST', '/api/cards/feedback', { app: 'kept', type: 'heads-up', card_key: 'AXA CAR INSURANCE', verdict: 'acted', d: '2026-10-17' });
  await D.handle('POST', '/api/cards/feedback', { app: 'decided', type: 'review', card_key: 'dec_1', verdict: 'useful' });
  let bad = null; try { await D.handle('POST', '/api/cards/feedback', { app: 'kept', type: 'x', card_key: 'y', verdict: 'loved' }); } catch (e) { bad = e.status; }
  eq(bad, 400);
  const b = (await call('bootstrap', 'GET')).body;
  eq(b.patterns.length, 1); eq(b.needsSchema, undefined);
  eq(b.feedback.length, 2, 'only KEPT\'s cards'); eq(b.feedback[1].verdict, 'acted');
  eq((await D.handle('GET', '/api/cards/feedback?app=decided')).feedback.length, 1);
});
await t('another active account sees none of these rows, through the routes or directly', async () => {
  const other = await S.signUp('other@example.com', 'Other');
  await S.admin("update public.profiles set status = 'active' where id = $1", [other]);
  as(other);
  eq((await call('transactions', 'GET', { query: 'all=1' })).body.total, 0);
  eq((await call('emis', 'GET')).body.emis.length, 0);
  eq((await S.asUser(other).select('kept_transactions')).length, 0, 'RLS, not just a filter in the route');
  // Writing a row into someone else's ledger is refused by the database.
  let refused = false;
  try { await S.asUser(other).insert('kept_transactions', { id: 'ktx_evil', user_id: uid, d: '2026-01-01', descr: 'x', amount_minor: -1, hash: 'h' }); } catch (e) { refused = e.status === 403; }
  ok(refused, 'cross-account insert refused');
  as(uid);
  ok((await call('transactions', 'GET', { query: 'all=1' })).body.total > 0, 'the owner still sees theirs');
});
await t('a pending account is told so, and the database gives it nothing', async () => {
  const p = await S.signUp('pending@example.com', 'Pending');
  as(p);
  const r = await call('bootstrap', 'GET');
  eq(r.status, 403); ok(/waiting for admin approval/.test(r.body.error));
  eq((await S.asUser(p).select('kept_profile')).length, 0);
  as(uid);
});
await t('signed out: every KEPT route answers 401 signedOut', async () => {
  as(null);
  let e = null;
  try { await D.handle('GET', '/api/kept/bootstrap'); } catch (err) { e = err; }
  eq(e.status, 401); eq(e.signedOut, true);
  as(uid);
});
await t('the analysis is computed in the browser and carries no narration', async () => {
  const r = await call('analysis', 'GET');
  eq(r.status, 200); ok(Array.isArray(r.body.findings.items)); eq(r.body.narration, null); eq(r.body.ai, false);
});
await t('mergeRows writes a large batch in one go and dedupes against what is there', async () => {
  const rows = [];
  for (let i = 0; i < 1200; i++) rows.push({ d: '2025-0' + (1 + (i % 9)) + '-1' + (i % 9), descr: 'BULK ' + i, amount_minor: -(100 + i), cat: 'Misc' });
  const r = await call('import', 'POST', { body: { rows, confirm: true } });
  eq(r.body.added, 1200);
  const list = await call('transactions', 'GET', { query: 'all=1' });
  eq(list.body.total, 1200, 'past the 1,000-row page');
  const again = await call('import', 'POST', { body: { rows: rows.slice(0, 10), confirm: true } });
  eq(again.body.updated, 10); eq(again.body.added, 0);
  eq((await call('transactions', 'GET', { query: 'all=1' })).body.total, 10);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
