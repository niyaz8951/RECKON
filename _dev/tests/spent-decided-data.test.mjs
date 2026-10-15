/* SPENT's and DECIDED's data layers against real Postgres (PGlite +
   supabase/schema.sql), every query as the signed-in person with row-level
   security on. All data invented. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { freshDb, ROOT } from './_pg.mjs';

const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' — ' + (e.stack || e.message)); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'expected truthy'); };

const S = await freshDb();
for (const f of ['assets/js/db.js', 'assets/js/routes-core.js', 'spent/spent-engine.js', 'spent/spent-data.js', 'decided/decided-engine.js', 'decided/decided-data.js']) require(resolve(ROOT, f));
const D = globalThis.TNData, SE = globalThis.SpentEngine;
const owner = await S.signUp('owner@example.com', 'Owner');
const uid = await S.signUp('tester@example.com', 'Tester');
await S.admin("update public.profiles set status = 'active' where id = $1", [uid]);
const as = (id) => D._use({ db: S.asUser(id), auth: { session: async () => (id ? { user: { id } } : null), signOut: async () => {} } });
as(uid);
async function call(path, method, body, query) {
  try { return { status: 200, body: await D.handle(method, path + (query ? '?' + query : ''), body) }; }
  catch (e) { return { status: e.status || 500, body: { error: e.message } }; }
}
const today = SE.iso(new Date()), yday = SE.addDays(today, -1);

/* ----------------------------------------------------------------- SPENT */
await t('spent: bootstrap creates the profile with defaults', async () => {
  const r = await call('/api/spent/bootstrap', 'GET');
  eq(r.status, 200, r.body.error); eq(r.body.profile.cats.length, 13); eq(r.body.profile.target_bp, 2000); eq(r.body.days.length, 0); eq(r.body.today, today);
  eq((await S.admin('select count(*)::int as n from public.spent_profile where user_id = $1', [uid]))[0].n, 1);
});
await t('spent: a day is written once and updated in place; junk is cleaned', async () => {
  let r = await call('/api/spent/day', 'PUT', { d: yday, blocks: { sleep: 420, work: 540, family: '60', bogus: 99, screen: -5 }, note: 'ok' });
  eq(r.status, 200, r.body.error); eq(r.body.day.blocks.family, 60); eq(r.body.day.blocks.bogus, undefined); eq(r.body.day.blocks.screen, undefined); eq(r.body.day.note, 'ok');
  r = await call('/api/spent/day', 'PUT', { d: yday, blocks: { sleep: 450, work: 540 } });
  eq(r.body.day.blocks.sleep, 450); eq(r.body.day.blocks.family, undefined);
  eq((await S.admin('select count(*)::int as n from public.spent_days where user_id = $1', [uid]))[0].n, 1, 'one row per day');
  eq((await call('/api/spent/day', 'PUT', { d: yday, blocks: { sleep: 900, work: 900 } })).status, 400, 'more than 24 hours');
  eq((await call('/api/spent/day', 'PUT', { d: SE.addDays(today, 3), blocks: { sleep: 1 } })).status, 400, 'the future');
  eq((await call('/api/spent/day', 'PUT', { d: 'nope', blocks: {} })).status, 400);
});
await t('spent: days are listed by range and come back in bootstrap', async () => {
  await call('/api/spent/day', 'PUT', { d: today, blocks: { sleep: 400 } });
  const r = await call('/api/spent/days', 'GET', null, 'from=' + yday + '&to=' + today);
  eq(r.body.days.length, 2); eq(r.body.days[0].d, yday);
  eq((await call('/api/spent/days', 'GET', null, 'from=' + today)).body.days.length, 1);
  eq((await call('/api/spent/bootstrap', 'GET')).body.days.length, 2);
});
await t('spent: profile edits are validated and kept', async () => {
  let r = await call('/api/spent/profile', 'PUT', { target_bp: 2500, weekend: [0, 6], rules: { weekday: { sleep: 450, work: 600, nope: 10 }, weekend: { sleep: 500 } } });
  eq(r.status, 200, r.body.error); eq(r.body.profile.target_bp, 2500); eq(r.body.profile.weekend.join(','), '0,6'); eq(r.body.profile.rules.weekday.work, 600); eq(r.body.profile.rules.weekday.nope, undefined);
  eq((await call('/api/spent/profile', 'PUT', { rules: { weekday: { sleep: 900, work: 900 } } })).status, 400);
  eq((await call('/api/spent/profile', 'PUT', { cats: [{ key: 'work', name: 'Work', cls: 'fixed' }, { key: 'x', name: 'X', cls: 'mine' }, { key: 'y', name: 'Y', cls: 'leak' }] })).status, 400, 'sleep stays');
  r = await call('/api/spent/profile', 'PUT', { cats: [{ key: 'sleep', name: 'Sleep', cls: 'fixed' }, { key: 'work', name: 'Work', cls: 'fixed' }, { key: 'deen', name: 'Deen', cls: 'mine', icon: 'sun' }] });
  eq(r.body.profile.cats.length, 3); eq(r.body.profile.cats[2].cls, 'mine');
  eq((await call('/api/spent/bootstrap', 'GET')).body.profile.cats.length, 3, 'persisted');
});

/* --------------------------------------------------------------- DECIDED */
let id1;
await t('decided: log, list, edit', async () => {
  let r = await call('/api/decided/decisions', 'POST', { title: 'Take the Riyadh role', choice: 'Yes', expected: 'Harder, better money', confidence: 80, domain: 'work', stakes: 'high', reversible: 0, review_on: SE.addDays(today, 90), options: ['Stay', 'Go', ''] });
  eq(r.status, 200, r.body.error); id1 = r.body.decision.id; ok(id1.startsWith('dec_'));
  eq(r.body.decision.status, 'open'); eq(r.body.decision.decided_on, today); eq(r.body.decision.reversible, false); eq(r.body.decision.options.length, 2);
  eq((await call('/api/decided/decisions', 'POST', { title: '', confidence: 70, review_on: today })).status, 400);
  eq((await call('/api/decided/decisions', 'POST', { title: 'x', confidence: 120, review_on: today })).status, 400);
  eq((await call('/api/decided/decisions', 'POST', { title: 'x', confidence: 70, review_on: '2020-01-01' })).status, 400, 'review before decision');
  r = await call('/api/decided/decisions', 'PUT', { id: id1, confidence: 70, domain: 'nope' });
  eq(r.status, 200, r.body.error); eq(r.body.decision.confidence, 70); eq(r.body.decision.domain, 'work', 'unknown domain keeps the old one'); eq(r.body.decision.title, 'Take the Riyadh role');
  eq((await call('/api/decided/bootstrap', 'GET')).body.decisions.length, 1);
});
await t('decided: review, reopen, delete', async () => {
  eq((await call('/api/decided/review', 'POST', { id: id1, outcome: '', outcome_score: 3, as_expected: 1 })).status, 400);
  eq((await call('/api/decided/review', 'POST', { id: id1, outcome: 'Fine', outcome_score: 9, as_expected: 1 })).status, 400);
  let r = await call('/api/decided/review', 'POST', { id: id1, outcome: 'Harder than I thought, money as expected.', outcome_score: 2, as_expected: 0, lesson: 'Halve the optimism.' });
  eq(r.status, 200, r.body.error); eq(r.body.decision.status, 'reviewed'); eq(r.body.decision.as_expected, 0); ok(r.body.decision.reviewed_at);
  eq((await call('/api/decided/decisions', 'PUT', { id: id1, title: 'x' })).status, 400, 'reviewed is history');
  r = await call('/api/decided/reopen', 'POST', { id: id1 });
  eq(r.body.decision.status, 'open'); eq(r.body.decision.reviewed_at, null);
  eq((await call('/api/decided/decisions', 'DELETE', null, 'id=' + id1)).status, 200);
  eq((await call('/api/decided/bootstrap', 'GET')).body.decisions.length, 0);
  eq((await S.admin('select count(*)::int as n from public.decisions where id = $1 and deleted_at is not null', [id1]))[0].n, 1, 'soft-deleted');
  eq((await call('/api/decided/decisions', 'DELETE', null, 'id=' + id1)).status, 404);
});
await t('isolation: another account sees none of it, and a pending account gets 403', async () => {
  as(owner);
  eq((await call('/api/spent/bootstrap', 'GET')).body.days.length, 0);
  eq((await call('/api/decided/bootstrap', 'GET')).body.decisions.length, 0);
  eq((await call('/api/decided/review', 'POST', { id: id1, outcome: 'hack', outcome_score: 3, as_expected: 1 })).status, 404);
  const p = await S.signUp('pending@example.com', 'P');
  as(p);
  eq((await call('/api/spent/bootstrap', 'GET')).status, 403);
  as(null);
  eq((await call('/api/decided/bootstrap', 'GET')).status, 401);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
